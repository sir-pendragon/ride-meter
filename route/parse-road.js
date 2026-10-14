// 道路(国道・県道)の通行規制ページを共通のレコードに変換する(青森県・福島県・群馬県)。
// 林道の規制が後から同じページに載ったときも、そのまま拾えるよう、ページ全体を読む。
// 判定の原則(他の県と同じ):
//  - 書かれていないことを「通行可能」とは判定しない。自転車は、原文に自転車の通行可否の記載があるときだけ true/false
//  - 規制の内容(全面通行止め・大型車のみ等)が一覧に無いものは、通行止めとは決めず「不明」にする
//  - 期間が明記され、終了済み・開始前のものは、いまの規制として扱わない
//  - 座標が公式データに無いものは、位置を決めない(青森県は公式の代表地点の座標がある)
(function (root) {
  const cl = (s) => String(s || '').replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nf = (s) => cl(String(s || '').normalize('NFKC'));
  const dayOf = (t) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

  // ---- JSON5(青森県の形式)を、評価(eval)せずに読む ----
  function parseJson5(src) {
    let i = 0; const s = String(src);
    const ws = () => { for (;;) { while (i < s.length && /\s/.test(s[i])) i++; if (s.startsWith('//', i)) { while (i < s.length && s[i] !== '\n') i++; } else if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; } else break; } };
    const str = () => {
      const q = s[i++]; let o = '';
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') { i++; const c = s[i++]; o += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === 'u' ? String.fromCharCode(parseInt(s.substr(i, 4), 16)) + (i += 4, '') : c; } else o += s[i++];
      }
      i++; return o;
    };
    const val = () => {
      ws(); const c = s[i];
      if (c === '{') {
        i++; const o = {};
        for (;;) {
          ws(); if (s[i] === '}') { i++; return o; }
          let k; if (s[i] === '"' || s[i] === "'") k = str(); else { const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i)); if (!m) throw new Error('JSON5: キーを読めません'); k = m[0]; i += k.length; }
          ws(); if (s[i++] !== ':') throw new Error('JSON5: ":" がありません'); o[k] = val(); ws(); if (s[i] === ',') i++;
        }
      }
      if (c === '[') { i++; const a = []; for (;;) { ws(); if (s[i] === ']') { i++; return a; } a.push(val()); ws(); if (s[i] === ',') i++; } }
      if (c === '"' || c === "'") return str();
      const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i)); if (!m) throw new Error('JSON5: 値を読めません(位置' + i + ')');
      i += m[0].length; return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'null' ? null : Number(m[0]);
    };
    const v = val(); ws(); if (i < s.length) throw new Error('JSON5: 余分な文字があります'); return v;
  }

  // ---- 共通 ----
  // 路線名: 「（主）青森五所川原線」→「青森五所川原線」/「（国）国道279号（下北半島縦貫道路）」→「国道279号」/「国 118号」→「国道118号」
  function routeOf(s) {
    let t = nf(s).replace(/^.*?土木\S*\s+/, '').replace(/^.*?(?:事務所|センター)\s+/, '');
    t = t.replace(/^[(（]\s*(?:国|主|一|県|市|町|村)\s*[)）]\s*/, '');
    t = t.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
    if (/^\d+号$/.test(t)) t = '国道' + t;
    return t;
  }
  // 「2026/09/14 12:00」「2026年10月19日08時30分」→ UTC日付(ms)。読めなければ null
  function dateOf(s) { const m = nf(s).match(/(\d{4})[\/年\-](\d{1,2})[\/月\-](\d{1,2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function state(startTxt, endTxt, today) {
    const d = dayOf(today); const a = dateOf(startTxt), b = dateOf(endTxt);
    if (b != null && b < d) return 'ended';
    if (a != null && a > d) return 'future';
    return 'active';
  }
  function kindOf(content) {
    const t = nf(content);
    if (/夜間|時間規制|時間指定|平日のみ|平日昼間/.test(t)) return { status: '一部規制', note: '時間帯・曜日が限られた規制(原文を確認)' };
    if (/大型|(\d|２|2)\s*t|中型/.test(t) && !/全面/.test(t)) return { status: '一部規制', note: '大型車等のみの規制(自転車の扱いは記載なし)' };
    if (/全面通行止|全面通行禁止|通行止|通行禁止|閉鎖|立入禁止|立ち入り禁止/.test(t)) return { status: '通行止め', note: null };
    return { status: '不明', note: '規制の内容(全面通行止めか、車線規制かなど)が一覧に書かれていません' };
  }
  function bikeOf(text) {
    const t = nf(text);
    if (/自転車[^、。]{0,10}(通行可|通行できます|通行可能)/.test(t)) return true;
    if (/自転車[^、。]{0,10}(通行不可|通行禁止|通行できません)/.test(t)) return false;
    return null;
  }
  const num = (s) => { const m = nf(s).match(/(\d+(?:\.\d+)?)\s*(km|m)/i); return m ? Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === 'km' ? 1000 : 1)) : null; };

  // ---- 青森県 ----
  function parseAomori(text, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now());
    const arr = parseJson5(text); if (!Array.isArray(arr)) throw new Error('一覧の形式が違います');
    const upd = opts.lastModified ? new Date(opts.lastModified) : null;
    const out = [];
    for (const x of arr) {
      if (!x || !x.route) continue;
      const st = state(x.start_date, x.end_date, today); if (st !== 'active') continue;
      const k = kindOf(x.content);
      const cause = x.cause === 1 ? '災害' : x.cause === 2 ? '工事' : 'その他';
      const sec = !x.end_point || x.end_point === '同上' ? cl(x.start_point) : `${cl(x.start_point)}～${cl(x.end_point)}`;
      const note = [k.note, x.remark ? '備考: ' + cl(String(x.remark).replace(/\n+/g, ' / ')) : '', '位置は公式の代表地点(座標1点)と延長からの推定'].filter(Boolean).join(' / ');
      const pt = Array.isArray(x.point) && x.point.length === 2 && isFinite(x.point[0]) && isFinite(x.point[1]) ? { lat: x.point[0], lon: x.point[1], lenM: num(x.extention) } : null;
      out.push({
        route: routeOf(x.route), municipality: null, typeText: `${cause}による規制: ${cl(x.content)}`, section: sec,
        period: `${cl(x.start_date)}～${cl(x.end_date)}`, reason: cl(x.reason) || null, status: k.status, scope: 'partial', note, bicycle: bikeOf(x.content + ' ' + x.remark),
        officialPoint: pt, layer: 'road', rid: 'AO#' + x.id, sourceUrl: url, officialUpdated: upd && !isNaN(upd) ? upd.toISOString().slice(0, 10) : null, fetchedAt,
        basis: '青森県「通行規制情報」の一覧(国道・県道)。公式の座標と延長から位置を推定',
      });
    }
    return out;
  }

  // ---- 福島県(4つのJSON) ----
  // lists: [{ kind:'災害'|'工事'|'冬期'|'その他', items:[...] }]
  function parseFukushima(lists, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now()); const out = [];
    let k = 0;
    for (const { kind, items } of lists) for (const x of items || []) {
      const st = state(x.kiseistartdate, x.kiseienddate, today); if (st !== 'active') continue;
      const nm = String(x.rosenmei || '').split(/\r?\n/).map(cl).filter(Boolean);
      const route = x.dorosyu === '国' ? ('国道' + nf(nm[0] || '').replace(/号?$/, '号')) : (nm.slice(-1)[0] || '');
      if (!route) continue;
      const kb = kindOf(String(x.kiseikbn || '').replace(/\r?\n/g, ' ')); const bk = bikeOf(String(x.bikou || '') + ' ' + String(x.kiseikbn || ''));
      const sec = [cl(x.sectionstart), cl(x.sectionend)].filter(Boolean); const section = sec.length === 2 && sec[0] !== sec[1] ? sec.join('～') : sec[0] || '';
      const note = [kb.note, x.bikou ? '備考: ' + cl(String(x.bikou).replace(/\r?\n/g, ' / ')) : '', x.encho ? `延長 ${cl(x.encho)}km` : ''].filter(Boolean).join(' / ');
      out.push({
        route, municipality: null, typeText: `${kind}: ${cl(String(x.kiseikbn || '').replace(/\r?\n/g, ' '))}`, section, period: `${cl(x.kiseistartdate)}～${cl(x.kiseienddate)}`,
        reason: cl(x.kiseiriyu) || null, status: kb.status, scope: 'partial', note: note || null, bicycle: bk, layer: 'road',
        rid: 'FK#' + (x.kanrinum || k++), sourceUrl: url, officialUpdated: opts.updated || null, fetchedAt,
        basis: '福島県「道路通行規制情報」の一覧(国道・県道)。区間は住所の記載のみで座標がないため位置は示しません',
      });
    }
    return out;
  }

  // ---- 群馬県(HTMLの表) ----
  function parseGunma(doc, url, fetchedAt, opts = {}) {
    const today = opts.today || new Date(fetchedAt || Date.now()); const out = [];
    const upd = nf(doc.body.textContent).match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*\d{1,2}時\d{1,2}分\s*現在/);
    const updated = upd ? `${upd[1]}-${String(upd[2]).padStart(2, '0')}-${String(upd[3]).padStart(2, '0')}` : null;
    const KINDS = { regulationList: '災害・大雨等', koujiRegulationList: '工事', kazanRegulationList: '火山', toukiRegulationList: '冬期閉鎖' };
    let k = 0;
    for (const t of doc.querySelectorAll('table')) {
      if (!/規制路線/.test(t.textContent)) continue;
      const kind = KINDS[t.id] || 'その他';
      for (const tr of t.rows) {
        const td = [...tr.cells].filter((c) => c.tagName === 'TD').map((c) => cl(c.textContent)); if (td.length < 5) continue;
        const [r0, sec, cause, st0, ed0] = td; const route = routeOf(r0); if (!route) continue;
        const stt = state(st0, ed0, today); if (stt !== 'active') continue;
        out.push({
          route, municipality: null, typeText: `${kind}: ${cause}`, section: sec ? sec.replace(/地内/g, '') : '', period: `${st0}～${ed0 || '未定'}`, reason: cause || null,
          status: '不明', scope: 'partial', note: '規制の内容(全面通行止めか車線規制か)は一覧になく、詳細ページ(取得できない形式)にあります', bicycle: null, layer: 'road',
          rid: 'GM#' + (k++), sourceUrl: url, officialUpdated: updated, fetchedAt,
          basis: '群馬県「道路規制情報」の一覧(国道・県道)。規制の内容が一覧にないため、通行止めとは判断しません',
        });
      }
    }
    return out;
  }

  const api = { parseJson5, routeOf, dateOf, state, kindOf, bikeOf, parseAomori, parseFukushima, parseGunma };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureRoad = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
