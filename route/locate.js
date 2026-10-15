// 規制レコード(路線名・区間の文言)を、OpenStreetMap の道に結び付ける。
// 方針(確定ではなく「候補」を返す):
//   ・同名の道は、つながっている単位(候補)に分ける。複数の候補があれば自動では確定しない。
//   ・市町村名が分かる場合は、規制レコードの市町村と一致しない候補を外す(分からない場合は外さず、その旨を記録)。
//   ・区間の文言(全線 / 起点からkm / 橋名・峠名)を読み取り、候補の道の上で該当部分を切り出す。
//   ・起点がどちらの端か分からない場合は「両端から測った2案」を出し、確定しない。
//   ・各候補に根拠(basis)と確度(confidence)を付ける。位置が付けられないものは地図に出さない。
(function (root) {
  const squash = (s) => (s || '').replace(/[\s　]+/g, '');
  const stripParen = (s) => s.replace(/[（(][^）)]*[）)]/g, '');
  const norm = (s) => squash(s).replace(/ケ/g, 'ヶ');
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  function hav(a, b) {
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // ---------- 名前 ----------
  function nameCandidates(route) {
    const base = squash(stripParen(route)).replace(/ケ/g, 'ヶ');
    const set = new Set();
    const stem = base.replace(/線$/, '');
    for (const n of [base, stem]) { set.add(`林道${n}`); set.add(`林道${n}線`); set.add(`${n}林道`); set.add(`${n}線`); }
    set.add(base);
    for (const s of [...set]) set.add(s.replace(/ヶ/g, 'ケ'));
    return [...set];
  }
  function forestStems(records) {
    const stems = new Set();
    for (const r of records) {
      const base = squash(stripParen(r.route)).replace(/線$/, '');
      if (base) { stems.add(base); stems.add(base.replace(/ヶ/g, 'ケ')); stems.add(base.replace(/ケ/g, 'ヶ')); }
    }
    return [...stems].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  }
  // 同梱した林道データ(事前取得)から、buildQueryと同じ条件(名前に「林道」を含み、路線名の語幹に一致、bboxと交差)で選ぶ
  function filterForest(elements, records, bbox) {
    const re = forestStems(records); if (!re) return [];
    const rx = new RegExp('(' + re + ')'); const [s, w, n, e] = bbox;
    return (elements || []).filter((el) => el.tags && /林道/.test(el.tags.name || '') && rx.test(el.tags.name) && (el.geometry || []).some((g) => g && g.lat >= s && g.lat <= n && g.lon >= w && g.lon <= e));
  }
  function buildQuery(records, bbox) {
    const re = forestStems(records);
    const [s, w, n, e] = bbox;
    return `[out:json][timeout:60];way["highway"]["name"~"林道"]["name"~"(${re})"](${s},${w},${n},${e});out tags geom;`;
  }
  // 道路(国道・県道)の規制用: 路線名で探す(「林道」を含む名前に限らない)。名前の一致は後段で完全一致のみ採用する
  function buildRoadQuery(records, bbox) {
    const names = new Set();
    for (const r of records) { for (const c of nameCandidates(r.route)) if (c.length >= 3 && (/林道/.test(r.route) || !/林道|線線$/.test(c))) names.add(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
    const [s, w, n, e] = bbox;
    return `[out:json][timeout:60];way["highway"]["name"~"(${[...names].join('|')})"](${s},${w},${n},${e});out tags geom;`;
  }
  // 橋・峠・トンネル(区間の目印)。名前のあるものだけ
  function buildLandmarkQuery(bbox) {
    const [s, w, n, e] = bbox; const b = `(${s},${w},${n},${e})`;
    return `[out:json][timeout:60];(node["natural"~"^(saddle|mountain_pass)$"]["name"]${b};way["bridge"="yes"]["name"]${b};way["tunnel"]["name"]${b};);out tags center;`;
  }
  function parseLandmarks(elements) {
    const out = [];
    for (const el of elements || []) {
      const t = el.tags || {}; if (!t.name) continue;
      const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
      if (lat == null || lon == null) continue;
      out.push({ name: t.name, lat, lon, kind: t.bridge ? 'bridge' : t.tunnel ? 'tunnel' : 'pass' });
    }
    return out;
  }

  // ---------- 区間の文言 ----------
  const kmNum = '(\\d+(?:\\.\\d+)?)\\s*(?:km|ｋｍ|㎞|キロ(?:メートル)?)';
  const dash = '[～〜~\\-ー−―から]+';
  function parseSection(text, scope) {
    let t = squash(text || '').replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    t = t.split('※')[0]; // 「※…までは通行可」などの注記は区間ではない
    // 複数の区間が書かれている(「1km～2km及び4km～5km」「A～B、C～D」)場合は、一部だけを採用すると残りを見落とすため扱わない
    const ranges = (t.match(/[～〜~]/g) || []).length;
    const kms = (t.match(new RegExp(kmNum, 'g')) || []).length;
    const multi = ranges >= 2 || (/(及び|並びに|、|,|と)/.test(t) && kms >= 2) || (ranges >= 1 && /(及び|並びに)/.test(t));
    let m;
    if (multi && !/^全線/.test(t)) return { type: 'unknown', multi: true, raw: t, why: '複数の区間が書かれているため、自動では位置を付けません' };
    // 起点より3.5km～終点 / 起点より3.5km地点から終点・以降・先 / 起点より3km～5km
    if ((m = t.match(new RegExp(`起点(?:側)?(?:より|から)${kmNum}(?:地点)?(?:${dash}|以降|より先|から先|以遠)(?:終点|まで)?(?:${kmNum})?`)))) {
      return { type: 'km', from: 'start', fromKm: +m[1], toKm: m[2] ? +m[2] : null, raw: t };
    }
    if ((m = t.match(new RegExp(`起点(?:側)?(?:より|から)${kmNum}(?:まで|区間|地点)?`)))) {
      return { type: 'km', from: 'start', fromKm: 0, toKm: +m[1], raw: t };
    }
    if ((m = t.match(new RegExp(`終点(?:側)?(?:より|から)${kmNum}`)))) {
      return { type: 'km', from: 'end', fromKm: 0, toKm: +m[1], raw: t };
    }
    if (scope === 'whole' || /^(全線|全区間|全面)/.test(t)) return { type: 'whole' };
    // 目印: AからB / A～B / AとBの間 (どちらも数字でない名前)
    if ((m = t.match(/([^\s～〜~\-、,。]{2,}?(?:橋|峠|トンネル|隧道|ダム|ゲート|分岐|入口|出口))(?:から|より|～|〜|~|-|と)([^\s～〜~\-、,。]{2,}?(?:橋|峠|トンネル|隧道|ダム|ゲート|分岐|入口|出口))(?:の間|まで|間)?/))) {
      return { type: 'landmark', a: m[1], b: m[2], raw: t };
    }
    if ((m = t.match(/([^\s、,。]{1,10}?橋)(?:が|は)?(?:通行不可|通行止め|通行できません|崩落|損壊|落橋)/))) {
      return { type: 'landmark', a: m[1], b: null, at: true, raw: t };
    }
    if ((m = t.match(/([^\s、,。]{1,10}?(?:橋|峠|トンネル|隧道|ダム))(?:付近|地点|から先|より先|から|より)/))) {
      return { type: 'landmark', a: m[1], b: null, raw: t };
    }
    return { type: 'unknown', raw: t };
  }

  // ---------- つながり(候補)への分割 ----------
  const GAP = 40;
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  function components(ways) {
    const parent = new Map(); const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    ways.forEach((w, i) => { const id = 'w' + i; parent.set(id, id); w.pts.forEach((p) => { const k = 'p' + key(p); if (!parent.has(k)) parent.set(k, k); union(id, k); }); });
    const groups = new Map();
    // OSMでは1本の林道が途切れて(端点が離れて)登録されていることがあるため、40m以内の端点どうしは同じ道とみなす
    const ends = []; ways.forEach((w, i) => { ends.push([i, w.pts[0]], [i, w.pts[w.pts.length - 1]]); });
    for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) if (ends[a][0] !== ends[b][0] && Math.abs(ends[a][1][0] - ends[b][1][0]) < 0.0005 && hav(ends[a][1], ends[b][1]) <= GAP) union('w' + ends[a][0], 'w' + ends[b][0]);
    ways.forEach((w, i) => { const r = find('w' + i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(w); });
    return [...groups.values()];
  }
  const wayLen = (pts) => { let t = 0; for (let i = 1; i < pts.length; i++) t += hav(pts[i - 1], pts[i]); return t; };

  // 候補の「主線」(一番長い経路)を端から端までの1本の折れ線にする。分岐があれば branched=true
  function mainPath(ways) {
    const adj = new Map(); const pt = new Map();
    const add = (a, b, d, geomIdx) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, d, geomIdx }); };
    const segs = [];
    for (const w of ways) for (let i = 1; i < w.pts.length; i++) {
      const a = key(w.pts[i - 1]), b = key(w.pts[i]); if (a === b) continue;
      pt.set(a, w.pts[i - 1]); pt.set(b, w.pts[i]); const d = hav(w.pts[i - 1], w.pts[i]);
      add(a, b, d); add(b, a, d); segs.push(d);
    }
    { // 途切れた端点どうし(40m以内)を、まっすぐな線でつなぐ
      const ends = [...adj.entries()].filter(([, v]) => v.length === 1).map(([k]) => k);
      for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) { const d = hav(pt.get(ends[a]), pt.get(ends[b])); if (d <= GAP && !adj.get(ends[a]).some((e) => e.to === ends[b])) { add(ends[a], ends[b], d); add(ends[b], ends[a], d); } }
    }
    const deg1 = [...adj.entries()].filter(([, v]) => v.length === 1).length;
    const branched = [...adj.values()].some((v) => v.length > 2);
    const far = (src) => { // 木とみなした最遠点(閉路があっても最短距離で近似)
      const dist = new Map([[src, 0]]); const prev = new Map(); const q = [src];
      while (q.length) { // 単純なラベル修正法(規模が小さいため十分)
        const u = q.shift();
        for (const e of adj.get(u) || []) { const nd = dist.get(u) + e.d; if (!dist.has(e.to) || nd < dist.get(e.to) - 1e-9) { dist.set(e.to, nd); prev.set(e.to, u); q.push(e.to); } }
      }
      let best = src; for (const [k, d] of dist) if (d > dist.get(best)) best = k;
      return { best, dist, prev };
    };
    const start = adj.keys().next().value; if (!start) return { path: [], branched: false, total: 0 };
    const a = far(start).best; const f = far(a); const b = f.best;
    const keys = []; for (let k = b; k !== undefined; k = f.prev.get(k)) keys.push(k);
    const path = keys.reverse().map((k) => pt.get(k));
    return { path, branched, total: wayLen(path), open: deg1 >= 2 };
  }

  // 折れ線の d0〜d1(m)の部分を切り出す
  function cutPath(path, d0, d1) {
    const out = []; let acc = 0;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 1; i < path.length; i++) {
      const seg = hav(path[i - 1], path[i]); const s = acc, e = acc + seg;
      if (e >= d0 && s <= d1 && seg > 0) {
        const t0 = Math.max(0, (d0 - s) / seg), t1 = Math.min(1, (d1 - s) / seg);
        if (!out.length) out.push(lerp(path[i - 1], path[i], t0));
        out.push(lerp(path[i - 1], path[i], t1));
      }
      acc = e;
    }
    return out;
  }
  // 点を折れ線へ投影し、始端からの距離(m)と離れ具合(m)を返す
  function project(path, p) {
    let best = { off: Infinity, along: 0 }; let acc = 0;
    const k = Math.cos(rad(p[0]));
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]; const seg = hav(a, b);
      const ax = (a[1] - p[1]) * k, ay = a[0] - p[0], bx = (b[1] - p[1]) * k, by = b[0] - p[0];
      const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const off = hav(q, p);
      if (off < best.off) best = { off, along: acc + seg * t };
      acc += seg;
    }
    return best;
  }

  // ---------- 候補ごとの区間の切り出し ----------
  function sectionsFor(sec, comp, landmarks) {
    const { path, total } = comp.main; const L = total;
    const mk = (d0, d1, level, confidence, basis, extra) => ({ d0, d1, pts: cutPath(path, d0, d1), level, confidence, basis, ...extra });
    if (sec.type === 'whole') return [mk(0, L, '推定', '中', '全線規制のため、同名の道の全体を当てはめた推定です')];
    if (sec.type === 'point') { // 公式データの代表地点(座標1点)と延長から切り出す。地点が区間の中央とは書かれていないため「要確認」
      const pr = project(path, [sec.lat, sec.lon]);
      if (pr.off > 300) return [{ pts: [], level: '不明', confidence: '低', basis: `公式の代表地点がこの道から約${Math.round(pr.off)}m離れており、同じ道とは確認できません` }];
      if (!sec.lenM) return [{ pts: [], level: '不明', confidence: '低', basis: '公式データに延長の記載がなく、区間の範囲を決められません' }];
      if (sec.lenM > 3000) return [{ pts: [], level: '不明', confidence: '低', basis: `延長${(sec.lenM / 1000).toFixed(1)}kmの区間ですが、公式の座標は代表地点1点だけで、区間の範囲を決められません`, point: [sec.lat, sec.lon] }];
      const half = sec.lenM / 2 + 50;
      return [mk(Math.max(0, pr.along - half), Math.min(L, pr.along + half), '要確認', '低', `公式の代表地点(座標。道から約${Math.round(pr.off)}m)と延長${sec.lenM}mから、地点の前後${Math.round(half)}mを切り出した推定です。地点が区間の中央とは書かれていません`)];
    }
    if (sec.type === 'km') {
      const out = [];
      const dirs = sec.from === 'start' ? [['A端', false], ['B端', true]] : [['A端', true], ['B端', false]];
      for (const [label, rev] of dirs) {
        const a = sec.fromKm * 1000, b = sec.toKm == null ? L : sec.toKm * 1000;
        if (a > L + 300) { out.push({ pts: [], level: '不明', confidence: '低', basis: `${sec.fromKm}kmは道の長さ(約${(L / 1000).toFixed(1)}km)を超えます(${label}から測定)`, invalid: true }); continue; }
        const d0 = rev ? Math.max(0, L - b) : a, d1 = rev ? L - a : Math.min(L, b);
        out.push(mk(d0, d1, '要確認', '低', `「起点」がどちらの端か公式資料に無いため、${label}から${sec.fromKm}km${sec.toKm == null ? '〜終点' : '〜' + sec.toKm + 'km'}で測った案です(OSMの長さ約${(L / 1000).toFixed(1)}km)`, { end: label }));
      }
      return out;
    }
    if (sec.type === 'landmark') {
      const find = (name) => {
        const n = norm(name); const hits = (landmarks || []).filter((l) => norm(stripParen(l.name)) === norm(stripParen(name))); // 一致は完全一致のみ(「久保橋」と「大久保橋」の取り違えを防ぐ)
        const near = hits.map((l) => ({ l, ...project(path, [l.lat, l.lon]) })).filter((h) => h.off <= 150);
        return near;
      };
      const A = find(sec.a); const B = sec.b ? find(sec.b) : null;
      if (A.length !== 1 || (sec.b && B.length !== 1)) {
        const why = !A.length ? `「${sec.a}」がこの道の近く(150m以内)のOSMデータにありません` : A.length > 1 ? `「${sec.a}」が複数見つかりました` : !B.length ? `「${sec.b}」がこの道の近く(150m以内)のOSMデータにありません` : `「${sec.b}」が複数見つかりました`;
        return [{ pts: [], level: '不明', confidence: '低', basis: why + '。位置は特定できません' }];
      }
      if (!sec.b && sec.at) { // 橋そのものが通れない: 橋の前後60mだけを区間とする(橋の長さはOSMの中心点しかないため幅は推定)
        const c = A[0].along; return [mk(Math.max(0, c - 60), Math.min(L, c + 60), '推定', '中', `「${sec.a}」が通行不可との記載のため、${A[0].l.src === 'google' ? 'Googleマップの検索結果' : A[0].l.src === 'gsi' ? '国土地理院の検索結果' : 'OSM上の橋'}の位置(道から約${Math.round(A[0].off)}m)の前後60mを区間としました(橋の範囲は推定)`)];
      }
      if (!sec.b) { // 目印の1点のみ: 区間は不明(「付近」など)
        return [{ pts: [], level: '不明', confidence: '低', basis: `「${sec.a}」の位置は分かりましたが、そこからどこまでかが文言から読み取れません`, point: [A[0].l.lat, A[0].l.lon] }];
      }
      const d0 = Math.min(A[0].along, B[0].along), d1 = Math.max(A[0].along, B[0].along);
      return [mk(d0, d1, '推定', '中', `「${sec.a}」と「${sec.b}」の位置(${[...new Set([A[0].l.src, B[0].l.src].map((x) => (x === 'google' ? 'Googleマップの検索' : x === 'gsi' ? '国土地理院の検索' : null)).filter(Boolean))].concat('OSM').join('と')}。道からそれぞれ約${Math.round(A[0].off)}m・${Math.round(B[0].off)}m)で区間を切り出しました`)];
    }
    return [{ pts: [], level: '不明', confidence: '低', basis: sec.why ? sec.why + '(' + (sec.raw || '') + ')' : '区間の文言を読み取れませんでした(' + (sec.raw || '記載なし') + ')' }];
  }

  // ---------- 本体 ----------
  // opts.landmarks: parseLandmarks() の結果 / opts.muniOf: (lat,lon)=>市町村名|null (任意)
  function locate(records, elements, opts = {}) {
    const byName = new Map();
    for (const el of elements) {
      if (!el.geometry || !el.tags || !el.tags.name) continue;
      const k = norm(el.tags.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push({ id: el.id, highway: el.tags.highway, surface: el.tags.surface || null, pts: el.geometry.map((g) => [g.lat, g.lon]) });
    }
    return records.map((r) => {
      const ways = [];
      for (const c of nameCandidates(r.route)) for (const w of byName.get(norm(c)) || []) if (!ways.includes(w)) ways.push(w);
      if (!ways.length) return { ...r, candidates: [], ways: [], selected: null, position: { level: 'なし', reason: 'OSMに同名の道が見つかりません(位置は表示しません)' } };
      const sec = r.officialPoint ? { type: 'point', ...r.officialPoint } : parseSection(r.section, r.scope);
      if (!r.municipality && r.layer !== 'road') { const mm = squash(r.section || '').match(/([\u4e00-\u9fff]{1,5}[市町村])[^（）()]{0,12}地内/); if (mm) r = { ...r, municipality: mm[1], municipalityFrom: '区間の文言' }; }
      let comps = components(ways).map((ws) => { const main = mainPath(ws); const c0 = main.path[Math.floor(main.path.length / 2)] || ws[0].pts[0]; const samples = main.total ? [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => { const q = cutPath(main.path, f * main.total, Math.min(main.total, f * main.total + 1)); return q[0] || c0; }) : [c0]; return { ways: ws, main, center: c0, samples }; });
      const notes = [];
      if (r.municipality && opts.muniOf) {
        const tag = norm(r.municipality.replace(/地内$/, ''));
        const kept = []; let unknown = 0;
        for (const c of comps) {
          // 長い林道は市町村をまたぐため、道に沿った複数の地点で調べ、1つでも一致すれば残す
          const ms = c.samples.map((q) => opts.muniOf(q[0], q[1])).filter(Boolean);
          const hit = ms.find((m) => norm(m) && (tag.includes(norm(m)) || norm(m).includes(tag)));
          if (!ms.length) { unknown++; kept.push({ ...c, muni: null }); } else if (hit) kept.push({ ...c, muni: hit }); else notes.push(`${[...new Set(ms)].join('・')}の同名の道を除外(規制は${r.municipality})`);
        }
        if (unknown) notes.push('市町村を判定できない候補があり、除外せず残しています');
        comps = kept;
      }
      if (!comps.length) return { ...r, candidates: [], ways: [], selected: null, position: { level: 'なし', reason: '同名の道はありますが、規制の市町村(' + r.municipality + ')と一致するものがありません。' + notes.join(' ') } };
      const candidates = [];
      comps.forEach((c, ci) => {
        const secs = c.main.path.length ? sectionsFor(sec, c, opts.landmarks) : [];
        secs.forEach((s, si) => candidates.push({ id: `${ci}-${si}`, comp: ci, center: c.center, samples: c.samples, ways: c.ways, muni: c.muni || null, lengthM: Math.round(c.main.total), branched: c.main.branched, ...s, basis: s.basis + (c.main.branched ? '(分岐があるため、最長の1本を対象にしています)' : '') }));
      });
      const usable = candidates.filter((c) => c.pts && c.pts.length > 1);
      let position, selected = null;
      if (!usable.length) position = { level: '不明', reason: candidates.length ? candidates[0].basis : '位置を付けられません' };
      else if (usable.length === 1 && comps.length === 1) { selected = usable[0]; position = { level: selected.level, reason: selected.basis, confidence: selected.confidence }; }
      else position = { level: '要確認', reason: `候補が${usable.length}件あり、自動では確定しません(同名の道${comps.length}か所/区間の案${usable.length}件)。地図で確かめて選んでください`, confidence: '低', multiple: true };
      if (notes.length) position.reason += ' / ' + notes.join(' ');
      return { ...r, candidates, usable, selected, ways: selected ? selected.ways : usable.length ? [...new Set(usable.flatMap((u) => u.ways))] : [...new Set(comps.flatMap((c) => c.ways))], section_parsed: sec, position };
    });
  }
  // 旧API(互換): locate() の薄いラッパー
  function match(records, elements, opts) { return locate(records, elements, opts); }

  const api = { nameCandidates, filterForest, buildQuery, buildRoadQuery, buildLandmarkQuery, parseLandmarks, parseSection, components, mainPath, cutPath, project, locate, match };
  if (typeof module !== 'undefined') module.exports = api; else root.ClosureLocate = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
