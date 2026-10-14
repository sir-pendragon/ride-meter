// 林道・道路の通行規制ページを取得して返すだけの中継(Cloudflare Workers 無料プラン用)
// - 取得先は ALLOWED_HOSTS の公式サイトだけ。それ以外のURLは取得しません。
// - アプリが「ルート計算」を押したときだけ呼ばれます(定期取得はしません)。
// - 解析はアプリ側で行います(Workers無料プランはCPU時間が1リクエスト10msのため)。
// - 返すのはHTML/PDFそのものと、取得時刻・取得元の更新日(Last-Modified)です。

const ALLOWED_HOSTS = new Set([
  'www.pref.saitama.lg.jp',
  'forestry-office.metro.tokyo.lg.jp',
  'www.pref.yamanashi.jp',
  'www.pref.tochigi.lg.jp',
  'www.pref.kanagawa.jp',
]);
// このアプリ(公開ページ)からの呼び出しだけを許可
const ALLOWED_ORIGINS = new Set(['https://sir-pendragon.github.io']);
const MAX_BYTES = 8 * 1024 * 1024; // 8MBまで
const UA = 'ride-meter-closure-relay/1.0 (+https://sir-pendragon.github.io/ride-meter/route/; 個人利用・ルート計算時のみ取得)';

function cors(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}


// ---- Geminiによる二重チェック(公式ページの本文を読ませて、規制の一覧を別の読み手で作らせる) ----
// - キーは Cloudflare の「秘密の値」GEMINI_API_KEY に置く(アプリやGitHubには置かない)
// - プロンプトとモデルはここで固定。呼び出し側が任意の質問をGeminiに送ることはできない
// - 返すのは「原文の引用つき」の抽出結果だけ。アプリ側で、引用が本文に実在するか確かめてから使う
const GEMINI_MODEL_DEFAULT = 'gemini-3.8-flash';
const AI_MAX_CHARS = 40000;
const AI_PROMPT = [
  'あなたは日本の道路・林道の通行規制ページの本文から、書かれている規制だけを抜き出す係です。',
  '守ること:',
  '- 本文に書かれていないことは書かない。推測しない。「通れる」と判断しない。',
  '- 自転車・軽車両・歩行者について本文に書かれていなければ bicycle は null にする。',
  '- 規制ごとに、本文からそのまま写した短い引用(quote、60文字以内)を必ず付ける。',
  '- status は「通行止め」「一部規制」「規制なし」「不明」のいずれか。区間や条件の記載が曖昧で判断できないときは「不明」。',
  '- 期間が終わっている、またはまだ始まっていない規制は status を「規制なし」にし、note に理由を書く(今日の日付は today で与える)。',
  '出力は次の形のJSONだけ: {"items":[{"route":"路線名","status":"通行止め|一部規制|規制なし|不明","section":"区間(本文のまま。なければ空)","period":"期間(本文のまま。なければ空)","bicycle":true|false|null,"quote":"本文からの引用","note":"補足(なければ空)"}]}',
].join('\n');

async function aiExtract(request, env, origin) {
  if (!env || !env.GEMINI_API_KEY) return json({ ok: false, error: 'ai not configured' }, 503, origin);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, origin); }
  const text = b && typeof b.text === 'string' ? b.text : '';
  const today = b && typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : '';
  if (!text || text.length > AI_MAX_CHARS) return json({ ok: false, error: 'text size' }, 413, origin);
  const model = (env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT).replace(/[^a-zA-Z0-9._-]/g, '');
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: AI_PROMPT + '\n\ntoday: ' + today + '\n\n--- 本文ここから ---\n' + text }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
  } catch (e) { return json({ ok: false, error: 'ai fetch failed' }, 502, origin); }
  if (!r.ok) return json({ ok: false, error: 'ai upstream', status: r.status }, 502, origin);
  let j; try { j = await r.json(); } catch { return json({ ok: false, error: 'ai bad response' }, 502, origin); }
  const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  const out = Array.isArray(parts) ? parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
  let parsed; try { parsed = JSON.parse(out); } catch { return json({ ok: false, error: 'ai not json' }, 502, origin); }
  const S = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
  const items = (Array.isArray(parsed && parsed.items) ? parsed.items : []).slice(0, 200).filter((x) => x && typeof x === 'object').map((x) => ({
    route: S(x.route), status: ['通行止め', '一部規制', '規制なし', '不明'].includes(x.status) ? x.status : '不明', section: S(x.section), period: S(x.period),
    bicycle: x.bicycle === true || x.bicycle === false ? x.bicycle : null, quote: S(x.quote).slice(0, 120), note: S(x.note),
  }));
  return json({ ok: true, model, items }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: 'origin' }, 403, origin);
    if (request.method === 'POST' && new URL(request.url).pathname === '/ai') return aiExtract(request, env, origin);
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405, origin);

    const target = new URL(request.url).searchParams.get('url');
    let u;
    try { u = new URL(target); } catch { return json({ ok: false, error: 'bad url' }, 400, origin); }
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
      return json({ ok: false, error: 'host not allowed', host: u.hostname }, 403, origin);
    }

    const t0 = Date.now();
    let r;
    try {
      r = await fetch(u.toString(), { headers: { 'User-Agent': UA }, redirect: 'manual', cf: { cacheTtlByStatus: { '200-299': 300, '300-599': 0 } } });
    } catch (e) {
      return json({ ok: false, error: 'fetch failed', detail: String(e) }, 502, origin);
    }
    // リダイレクト先も許可ドメインに限る(手動で最大3回まで追う)
    for (let hop = 0; hop < 3 && r.status >= 300 && r.status < 400; hop++) {
      const loc = r.headers.get('Location');
      if (!loc) return json({ ok: false, error: 'bad redirect' }, 502, origin);
      let l; try { l = new URL(loc, u); } catch { return json({ ok: false, error: 'bad redirect' }, 502, origin); }
      if (l.protocol !== 'https:' || !ALLOWED_HOSTS.has(l.hostname)) return json({ ok: false, error: 'redirect not allowed' }, 403, origin);
      u = l;
      try { r = await fetch(l.toString(), { headers: { 'User-Agent': UA }, redirect: 'manual' }); } catch (e) { return json({ ok: false, error: 'fetch failed' }, 502, origin); }
    }
    if (r.status >= 300 && r.status < 400) return json({ ok: false, error: 'too many redirects' }, 502, origin);
    const len = Number(r.headers.get('Content-Length') || 0);
    if (len > MAX_BYTES) return json({ ok: false, error: 'too large' }, 413, origin);
    const body = await r.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return json({ ok: false, error: 'too large' }, 413, origin);

    const headers = {
      'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream',
      'X-Upstream-Status': String(r.status),
      'X-Fetched-At': new Date().toISOString(),
      'X-Fetch-Ms': String(Date.now() - t0),
      'Access-Control-Expose-Headers': 'X-Upstream-Status, X-Fetched-At, X-Upstream-Last-Modified, X-Upstream-Etag, X-Fetch-Ms',
      ...cors(origin),
    };
    const lm = r.headers.get('Last-Modified');
    if (lm) headers['X-Upstream-Last-Modified'] = lm;
    const et = r.headers.get('ETag');
    if (et) headers['X-Upstream-Etag'] = et;
    return new Response(body, { status: 200, headers });
  },
};
