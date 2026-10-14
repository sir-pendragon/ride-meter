// 市町村の通行規制ページ台帳(data/muni-inventory/*.json)と、ルートが通る市町村の突き合わせ。
// 台帳は調査途中。「未確認」は「規制ページが無い」という意味ではない。
(function (root) {
  const FILES = { 茨城県: 'ibaraki', 栃木県: 'tochigi', 群馬県: 'gunma', 埼玉県: 'saitama', 千葉県: 'chiba', 東京都: 'tokyo', 神奈川県: 'kanagawa', 福島県: 'fukushima' };
  const CONFIRMED = new Set(['found', 'found_empty', 'index_only']);
  // 国土地理院の表では政令市の区が「相模原市　緑区」のように入る。台帳は市単位なので、区を落として市に寄せる
  const normName = (n) => String(n || '').replace(/[\s　].*$/, '').trim();
  const keyOf = (pref, name) => pref + '|' + normName(name);
  function build(byPref) {
    const m = new Map();
    for (const pref of Object.keys(byPref || {})) for (const x of byPref[pref] || []) m.set(keyOf(x.pref || pref, x.name), x);
    return m;
  }
  const isConfirmed = (x) => !!x && CONFIRMED.has(x.status) && /^https?:\/\//.test(x.url || '');
  // keys: ルートが通る市町村の "県名|市町村名" の配列。戻り値: 台帳で確認済み / 未確認 / 台帳に無い県
  function forRoute(reg, keys) {
    const seen = new Set(); const listed = []; const unconfirmed = []; const outside = [];
    for (const k of keys || []) {
      const key = keyOf(k.split('|')[0], k.split('|').slice(1).join('|'));
      if (seen.has(key)) continue; seen.add(key);
      const [pref, name] = key.split('|');
      if (!FILES[pref]) { outside.push({ pref, name }); continue; }
      const x = reg.get(key);
      if (isConfirmed(x)) listed.push(x); else unconfirmed.push({ pref, name, status: x ? x.status : '台帳に無し' });
    }
    return { listed, unconfirmed, outside };
  }
  async function load(prefs, fetchJson) {
    const by = {}; const errs = [];
    for (const p of prefs) { if (!FILES[p]) continue; try { by[p] = await fetchJson(`../data/muni-inventory/${FILES[p]}.json`); } catch (e) { errs.push(p); } }
    return { reg: build(by), errs };
  }
  // 取得先を市町村で絞る: 通る市町村が判定できていない(null)ときは絞らない(取りこぼし側に倒さない)
  const wantsMuni = (src, keys) => !src.muni || !keys || keys.has(src.muni);
  const api = { FILES, normName, keyOf, build, isConfirmed, forRoute, load, wantsMuni };
  if (typeof module !== 'undefined') module.exports = api; else root.MuniRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
