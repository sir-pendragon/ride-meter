// 林道・道路の通行規制ページを取得して返すだけの中継(Cloudflare Workers 無料プラン用)
// - 取得先は ALLOWED_HOSTS の公式サイトだけ。それ以外のURLは取得しません。
// - アプリが「ルート計算」を押したときだけ呼ばれます(定期取得はしません)。
// - 解析はアプリ側で行います(Workers無料プランはCPU時間が1リクエスト10msのため)。
// - 返すのはHTML/PDFそのものと、取得時刻・取得元の更新日(Last-Modified)です。

const ALLOWED_HOSTS = new Set([
  'www.pref.saitama.lg.jp',
  'forestry-office.metro.tokyo.lg.jp',
  'www.pref.yamanashi.jp',
]);
// このアプリ(公開ページ)からの呼び出しだけを許可
const ALLOWED_ORIGINS = new Set(['https://sir-pendragon.github.io']);
const MAX_BYTES = 8 * 1024 * 1024; // 8MBまで
const UA = 'ride-meter-closure-relay/1.0 (+https://sir-pendragon.github.io/ride-meter/route/; 個人利用・ルート計算時のみ取得)';

function cors(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405, origin);
    if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: 'origin' }, 403, origin);

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
