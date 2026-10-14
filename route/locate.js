// 規制レコード(路線名)を、OpenStreetMap の同名の林道に結び付ける。
// 結果は「確定」ではなく「推定」。名前が一致しても、規制区間そのものとは限らない。
//   scope 'whole'   : 全線規制 → 一致した道の全体を「推定(全線)」として返す
//   scope 'partial' : 一部区間 → 一致した道を「要確認」として返す(区間は原文のまま。自動で避けない)
//   scope 'unknown' : 位置を付けない
// 同名の道が複数の場所にある場合に備え、必ず範囲(bbox)を指定して検索する。
(function (root) {
  const squash = (s) => (s || '').replace(/\s+/g, '');
  const stripParen = (s) => s.replace(/[（(][^）)]*[）)]/g, '');

  // OSM上の名前の候補(表記ゆれ: 林道○○線 / ○○林道 / ○○線)
  function nameCandidates(route) {
    const base = squash(stripParen(route)).replace(/ケ/g, 'ヶ');
    const set = new Set();
    const stem = base.replace(/線$/, '');
    for (const n of [base, stem]) {
      set.add(`林道${n}`); set.add(`林道${n}線`); set.add(`${n}林道`); set.add(`${n}線`);
    }
    set.add(base);
    // 表記ゆれ: ヶ/ケ
    for (const s of [...set]) set.add(s.replace(/ヶ/g, 'ケ'));
    return [...set];
  }
  const norm = (s) => squash(s).replace(/ケ/g, 'ヶ');

  // 範囲内で「林道」を含む名前の道のうち、路線名の語幹を含むものだけを取得し、厳密な一致は match() で判定する
  function buildQuery(records, bbox) {
    const stems = new Set();
    for (const r of records) {
      const base = squash(stripParen(r.route)).replace(/線$/, '');
      if (base) { stems.add(base); stems.add(base.replace(/ヶ/g, 'ケ')); stems.add(base.replace(/ケ/g, 'ヶ')); }
    }
    const re = [...stems].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const [s, w, n, e] = bbox;
    return `[out:json][timeout:60];way["highway"]["name"~"林道"]["name"~"(${re})"](${s},${w},${n},${e});out tags geom;`;
  }

  // records: 規制レコード配列, elements: Overpassの結果(out tags geom)
  function match(records, elements) {
    const byName = new Map();
    for (const el of elements) {
      if (!el.geometry || !el.tags || !el.tags.name) continue;
      const k = norm(el.tags.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push({ id: el.id, highway: el.tags.highway, surface: el.tags.surface || null, pts: el.geometry.map((g) => [g.lat, g.lon]) });
    }
    return records.map((r) => {
      const hits = [];
      for (const c of nameCandidates(r.route)) for (const w of byName.get(norm(c)) || []) if (!hits.includes(w)) hits.push(w);
      let position;
      if (!hits.length) position = { level: 'なし', reason: 'OSMに同名の道が見つかりません(位置は表示しません)' };
      else if (r.scope === 'whole') position = { level: '推定', reason: '全線規制。OSMの同名の道を全体に当てはめた推定です(要確認)' };
      else if (r.scope === 'partial') position = { level: '要確認', reason: '一部区間の規制。区間は原文のとおりで、自動では避けません' };
      else position = { level: 'なし', reason: '規制の範囲が読み取れないため、位置は付けません' };
      return { ...r, position, ways: hits };
    });
  }
  const api = { nameCandidates, buildQuery, match };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureLocate = api;
})(typeof self !== 'undefined' ? self : this);
