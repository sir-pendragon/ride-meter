// 「快適・絶景」モードの評価(通信しない純粋関数)。
// 静かさ Q(推定) 45% / 激坂の少なさ H 35% / 景観 V(推定) 20%。すべて固定の基準で 0〜1 に正規化し、生の値も返す。
// 重み・しきい値・基準値はすべて仮置き(実データで調整する前提)。
//  - 交通量の実測ではない。OSMの道路種別などからの代理指標(推定)。
//  - 自転車で走れると確認できた辺だけを静かさの評価に使う(押し歩き・フェリー・不明は評価に入れず、割合を返す)。
//  - 橋・トンネルの辺だけ、両端の標高を直線で結ぶ。根拠のない急勾配は消さない。
(function (root) {
  'use strict';
  const WEIGHTS = { q: 0.45, h: 0.35, v: 0.20 };
  // 登りの窓平均勾配 → 重み。窓は100mと200m。地点ごとに大きいほうを採る(二重計上しない)。
  const GRADE = { wins: [100, 200], tiers: [[0.15, 4], [0.12, 2], [0.09, 1]], K: 0.25, anomaly: 0.30 };
  const RC = { service_other: 0.2, residential: 0.2, unclassified: 0.3, tertiary: 0.5, secondary: 0.75, primary: 0.9, trunk: 1.0, motorway: 1.0 };
  const OFF = new Set(['cycleway', 'mountain_bike', 'track', 'footway', 'sidewalk', 'path', 'pedestrian']);
  const NONRIDE = new Set(['steps', 'ferry', 'rail-ferry', 'rail', 'bus', 'tram', 'elevator', 'escalator', 'egress_connection', 'platform_connection', 'transit_connection']);
  // 国道など交通量の多い幹線道路(OSMの trunk / primary)が長く続くルートへの減点。重み・しきい値はすべて仮置き。
  //  減点 = k × (幹線道路の長さ − freeM) ÷ ルート長(上限 maxPen)。交差・短い併用(freeM まで)は減点しない。
  //  warnM 以上、または warnShare 以上のときは画面に警告を出す。
  const HEAVY = { classes: new Set(['trunk', 'primary', 'motorway']), freeM: 1000, k: 0.8, maxPen: 0.6, warnM: 3000, warnShare: 0.3 };
  const NEUTRAL = 0.5; // 不明な辺の交通指数(静かとも多いとも言わない)
  const ATTRS = ['edge.surface', 'edge.length', 'edge.road_class', 'edge.use', 'edge.lane_count', 'edge.speed_limit', 'edge.cycle_lane', 'edge.bridge', 'edge.tunnel', 'edge.travel_mode', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'];
  // shape と begin/end_shape_index は、橋・トンネルの位置をルート上に正確に重ねるために使う(辺の長さの比例配分は、実測で0.3%ずれた)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = Math.PI / 180;
  const hv = (a, b) => { const dl = (b[0] - a[0]) * rad, dg = (b[1] - a[1]) * rad; const s = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dg / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s))); };

  /* ---- 自転車で走れるか(trace_attributes の edge.travel_mode / edge.use) ---- */
  function edgeAccess(e) {
    if (!e) return 'unknown';
    if (NONRIDE.has(e.use)) return 'walk';
    if (e.travel_mode === 'pedestrian') return 'walk';
    if (e.travel_mode === 'bicycle') return 'ok';
    return 'unknown';
  }
  /* 交通指数 T(0=静か 1=交通が多い)。走れると確認できない辺・道路種別が不明な辺は null(評価しない) */
  function trafficIndex(e) {
    if (edgeAccess(e) !== 'ok') return null;
    if (OFF.has(e.use)) return 0;
    let b = RC[e.road_class];
    if (b === undefined) return null;
    const lc = Number(e.lane_count); if (Number.isFinite(lc) && lc >= 3) b += 0.1;
    const sp = Number(e.speed_limit); if (Number.isFinite(sp) && sp >= 50) b += 0.1; // 0・欠損は補正しない(低速と解釈しない)
    if (e.cycle_lane === 'separated') b -= 0.1; else if (e.cycle_lane === 'dedicated') b -= 0.05;
    return clamp(b, 0, 1);
  }
  /* 辺長の単位ずれ(km/m)に左右されないよう、辺長の合計をルート長に合わせて正規化する */
  function edgeScale(edges, routeM) {
    let tot = 0; for (const e of edges || []) tot += Math.max(0, Number(e.length) || 0);
    if (!(tot > 0) || !(routeM > 0)) return { tot, scale: 1, ok: false };
    const scale = routeM / tot; // km なら約1000
    const ok = Math.abs(scale - 1000) / 1000 < 0.25; // 辺の合計がルート長と25%以上ずれる場合は、位置の対応に使わない
    return { tot, scale, ok };
  }
  /* 静かさ Q と、評価に使えなかった割合 */
  function analyzeEdges(edges, routeM) {
    const { tot, scale } = edgeScale(edges, routeM);
    if (!(tot > 0)) return null;
    let sumT = 0, unk = 0, walk = 0, known = 0, heavy = 0, run = 0, maxRun = 0;
    for (const e of edges) {
      const L = Math.max(0, Number(e.length) || 0); if (!L) continue;
      const a = edgeAccess(e), t = trafficIndex(e);
      if (a === 'ok' && HEAVY.classes.has(e.road_class)) { heavy += L; run += L; if (run > maxRun) maxRun = run; } else run = 0;
      if (a === 'walk') { walk += L; unk += L; sumT += L * NEUTRAL; }
      else if (t == null) { unk += L; sumT += L * NEUTRAL; }
      else { known += L; sumT += L * t; }
    }
    return { Q: clamp(1 - sumT / tot, 0, 1), unknownRatio: unk / tot, walkRatio: walk / tot, walkM: walk / tot * (routeM || tot * scale), knownRatio: known / tot, n: edges.length, heavyShare: heavy / tot, heavyM: heavy / tot * (routeM || tot * scale), heavyRunM: maxRun / tot * (routeM || tot * scale) };
  }
  /* 辺ごとの区間(ルート上の距離 m)。橋・トンネルの補正、交通指数が高い区間の検出に使う */
  function edgeSpans(edges, routeM) {
    const { tot, scale, ok } = edgeScale(edges, routeM);
    if (!ok) return { ok: false, spans: [] };
    const spans = []; let acc = 0;
    for (const e of edges) {
      const L = Math.max(0, Number(e.length) || 0) * scale; if (!L) continue;
      spans.push({ a: acc, b: acc + L, T: trafficIndex(e), access: edgeAccess(e), bridge: !!e.bridge, tunnel: !!e.tunnel, rc: e.road_class || null, use: e.use || null });
      acc += L;
    }
    return { ok: true, spans };
  }
  function structureRanges(spans) {
    const out = [];
    for (const s of spans) if (s.bridge || s.tunnel) { const l = out[out.length - 1]; if (l && Math.abs(l.b - s.a) < 1) l.b = s.b; else out.push({ a: s.a, b: s.b }); }
    return out;
  }
  /* 橋・トンネルの区間を、照合結果の形状(shape)の座標からルート上の距離に直す。辺の長さを比例配分するより正確。
     どれか1つでもルートから maxD m 以上離れたら null(呼び出し側は比例配分に戻る) */
  function segProj(D, i, p) {
    const a = [D.la[i], D.lo[i]], b = [D.la[i + 1], D.lo[i + 1]], kx = 111320 * Math.cos(a[0] * rad), ky = 110540;
    const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * ky, px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * ky, L2 = bx * bx + by * by;
    const t = L2 > 0 ? clamp((px * bx + py * by) / L2, 0, 1) : 0, dx = px - t * bx, dy = py - t * by;
    return { s: D.s[i] + t * (D.s[i + 1] - D.s[i]), d: Math.sqrt(dx * dx + dy * dy) };
  }
  function locateOn(D, p, from, maxD, minS) {   // from 以降・距離 minS 以降で、最初に maxD 以内に入る場所の、局所的に最も近い位置(同じ場所を2度通るルートでも、進む順に対応させる)
    const n = D.s.length; let best = null;
    for (let i = Math.max(0, from); i < n - 1; i++) {
      const q = segProj(D, i, p); if (q.s < minS) continue;
      if (q.d <= maxD) { if (!best || q.d < best.d) best = { s: q.s, d: q.d, i }; }
      else if (best) break;
    }
    return best;
  }
  function alignedRanges(D, edges, maxD) {
    maxD = maxD || 30; const out = []; let cur = 0, endS = -Infinity;
    if (!D || !Array.isArray(edges)) return null;
    for (const e of edges) {
      if (!(e && (e.bridge || e.tunnel))) continue;
      if (!e._p0 || !e._p1) return null;
      const a = locateOn(D, e._p0, cur, maxD, endS - 1); if (!a) return null;
      const b = locateOn(D, e._p1, a.i, maxD, a.s); if (!b) return null;
      cur = a.i; endS = b.s;
      const l = out[out.length - 1];
      if (l && a.s - l.b < 1) l.b = Math.max(l.b, b.s); else out.push({ a: a.s, b: b.s });
    }
    return out;
  }
  /* 区間の両端を pad m ずつ広げる(標高データの1画素分。橋台・坑口の画素は、谷や斜面の標高が混ざるため)。重なれば結合 */
  function padRanges(ranges, pad, total) {
    const out = [];
    for (const r of ranges || []) { const a = Math.max(0, r.a - pad), b = Math.min(total == null ? Infinity : total, r.b + pad); const l = out[out.length - 1]; if (l && a <= l.b) l.b = Math.max(l.b, b); else out.push({ a, b }); }
    return out;
  }
  /* 橋・トンネルの区間だけ、区間の両端のすぐ外側(区間の外で最も近い標高点)の標高を直線で結ぶ。それ以外の区間(実在する激坂を含む)には触れない */
  function correctZ(D, z, ranges) {
    const out = z.slice(); let changed = 0, used = 0;
    for (const r of ranges || []) {
      let ia = -1, ib = -1;
      for (let i = 0; i < D.s.length; i++) { if (D.s[i] < r.a) ia = i; if (D.s[i] > r.b) { ib = i; break; } }
      if (ia < 0) ia = 0; if (ib < 0) ib = D.s.length - 1;
      if (ib - ia < 2) continue;
      const za = z[ia], zb = z[ib], ds = D.s[ib] - D.s[ia]; if (!(ds > 0) || !Number.isFinite(za) || !Number.isFinite(zb)) continue;
      used++;
      for (let k = ia + 1; k < ib; k++) { const v = za + (zb - za) * (D.s[k] - D.s[ia]) / ds; if (Math.abs(v - out[k]) > 0.05) changed++; out[k] = v; }
    }
    return { z: out, changed, used };
  }

  /* ---- 激坂の少なさ H ---- */
  function tierOf(g) { for (const [th, p] of GRADE.tiers) if (g >= th) return p; return 0; }
  function gradeProfile(D, z) {
    const n = z.length, pen = new Array(n).fill(0); let anom = 0;
    for (const W of GRADE.wins) {
      let j = 0, badEnd = -1;
      for (let i = 0; i < n - 1; i++) {
        if (j < i) j = i;
        while (j < n - 1 && D.s[j] - D.s[i] < W) j++;
        const dd = D.s[j] - D.s[i]; if (dd < W * 0.9) break;
        const g = (z[j] - z[i]) / dd; if (g <= 0) continue; // 下りは評価しない
        if (W === 200 && g > GRADE.anomaly) { if (i > badEnd) anom++; badEnd = j; }
        const t = tierOf(g); if (t) for (let k = i; k < j; k++) if (pen[k] < t) pen[k] = t;
      }
    }
    let sum = 0; const m = { t1: 0, t2: 0, t4: 0 }; const runs = []; let run = null;
    for (let k = 0; k < n - 1; k++) {
      const ds = D.s[k + 1] - D.s[k]; sum += ds * pen[k];
      if (pen[k] === 1) m.t1 += ds; else if (pen[k] === 2) m.t2 += ds; else if (pen[k] === 4) m.t4 += ds;
      if (pen[k] === 4) { if (!run) { run = { a: D.s[k], b: D.s[k + 1] }; runs.push(run); } else run.b = D.s[k + 1]; } else run = null;
    }
    const L = D.total || (D.s[n - 1] || 0);
    const H = L > 0 ? clamp(1 - sum / (L * GRADE.K), 0, 1) : null;
    return { H, pen, steepM: m, runs15: runs, anomalies: anom, n15: runs.length, m15: m.t4 };
  }

  /* ---- 景観 V(推定): 展望地・山頂/峠・水域・海岸。森林・山並みは対象外 ----
     feat = { points:[{t:'viewpoint'|'peak'|'pass',lat,lon}], lines:[[[lat,lon],...]] | null }  lines が null なら水域は未評価 */
  function densifyLL(poly, step) {
    const out = [poly[0]];
    for (let i = 1; i < poly.length; i++) { const a = poly[i - 1], b = poly[i], d = hv(a, b), k = Math.floor(d / step); for (let j = 1; j <= k; j++) out.push([a[0] + (b[0] - a[0]) * j / (k + 1), a[1] + (b[1] - a[1]) * j / (k + 1)]); out.push(b); }
    return out;
  }
  function gridIndex(points, cell) { const m = new Map(); for (const p of points) { const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell); (m.get(k) || m.set(k, []).get(k)).push(p); } return m; }
  function nearAny(idx, cell, p, r) { const a = Math.floor(p[0] / cell), b = Math.floor(p[1] / cell); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) { const l = idx.get((a + x) + ',' + (b + y)); if (l) for (const q of l) if (hv(p, q) <= r) return true; } return false; }
  /* 景観は「連続値・距離で重み・長さで正規化」(以前は 展望地等3か所・水域30% で頭打ちになり、川沿いの実ルートで全候補が1.0になった)。
     展望地・山頂・峠: ルートからの距離 100m以内=1、300mで0 の重みの合計を、1kmあたりにして、1-exp(-密度/PT_K)。
     水域: ルートの各点から最も近い水域までの距離 50m以内=1、200mで0 の重みの平均を、1-exp(-値/WT_K)。
     V = 0.4×点 + 0.6×水域(配分は従来どおり)。基準値 PT_K・WT_K は仮置き(実データ1ルートで、差が出ることを確認しただけ) */
  const POINT_R = 300, POINT_FULL = 100, WATER_R = 200, WATER_FULL = 50, PT_K = 0.5, WT_K = 0.35, CELL = 0.0035;
  const wLin = (d, full, zero) => (d <= full ? 1 : d >= zero ? 0 : (zero - d) / (zero - full));
  function nearestIn(idx, cell, p, r) { const a = Math.floor(p[0] / cell), b = Math.floor(p[1] / cell); let m = Infinity; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) { const l = idx.get((a + x) + ',' + (b + y)); if (l) for (const q of l) { const d = hv(p, q); if (d < m) m = d; } } return m <= r ? m : Infinity; }
  function scenicScore(D, feat) {
    if (!feat) return null;
    const rp = []; for (let i = 0; i < D.la.length; i++) rp.push([D.la[i], D.lo[i]]);
    const L = D.total || (D.s && D.s[D.s.length - 1]) || 0, km = Math.max(L / 1000, 0.5);
    const cnt = { viewpoint: 0, peak: 0, pass: 0 }; let nPts = 0, wsum = 0;
    if (feat.points && feat.points.length) {
      const idx = gridIndex(rp, CELL);
      for (const f of feat.points) { const d = nearestIn(idx, CELL, [f.lat, f.lon], POINT_R); if (d === Infinity) continue; nPts++; if (cnt[f.t] != null) cnt[f.t]++; wsum += wLin(d, POINT_FULL, POINT_R); }
    }
    const density = wsum / km, pointScore = 1 - Math.exp(-density / PT_K);
    let share = null, waterW = null, V = pointScore, partial = true, waterScore = null;
    if (feat.lines) {
      partial = false;
      const wp = []; for (const w of feat.lines) if (w && w.length > 1) for (const p of densifyLL(w, 20)) wp.push(p);
      if (wp.length && rp.length) { const idx = gridIndex(wp, CELL); let hit = 0, ws = 0; for (const p of rp) { const d = nearestIn(idx, CELL, p, WATER_R); if (d <= 100) hit++; if (d !== Infinity) ws += wLin(d, WATER_FULL, WATER_R); } share = hit / rp.length; waterW = ws / rp.length; }
      else { share = 0; waterW = 0; }
      waterScore = 1 - Math.exp(-waterW / WT_K);
      V = 0.4 * pointScore + 0.6 * waterScore;
    }
    const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
    return { V: clamp(V, 0, 1), points: nPts, counts: cnt, density: r3(density), pointScore: r3(pointScore), waterShare: share, waterW: r3(waterW), waterScore: r3(waterScore), partial };
  }

  /* ---- 総合スコア: 全候補で評価できた指標だけで重みを正規化して比べる(一部の候補だけ指標がある状態では比べない) ---- */
  function composite(parts, avail) {
    let w = 0, s = 0;
    for (const k of ['q', 'h', 'v']) { const v = parts[k.toUpperCase()]; if (avail[k] && v != null) { w += WEIGHTS[k]; s += WEIGHTS[k] * v; } }
    return w > 0 ? s / w : null;
  }
  /* 幹線道路が長く続くことへの減点(0〜maxPen)。道路の属性が取得できていない候補は0(減点しない) */
  function heavyPenalty(cm, routeM) {
    if (!cm || !(cm.heavyM > 0) || !(routeM > 0)) return 0;
    return clamp(HEAVY.k * Math.max(0, cm.heavyM - HEAVY.freeM) / routeM, 0, HEAVY.maxPen);
  }
  function heavyWarn(cm) { return !!cm && ((cm.heavyM || 0) >= HEAVY.warnM || (cm.heavyShare || 0) >= HEAVY.warnShare); }
  function scoreAll(cands) {
    const has = (c, k) => c.cmf && c.cmf[k] != null;
    const avail = { q: cands.length > 0 && cands.every(c => has(c, 'Q')), h: cands.length > 0 && cands.every(c => has(c, 'H')), v: cands.length > 0 && cands.every(c => has(c, 'V')) };
    for (const c of cands) { if (!c.cmf) c.cmf = {}; const b = composite(c.cmf, avail); c.cmf.pen = heavyPenalty(c.cmf, c.len); c.cmf.S = b == null ? null : Math.max(0, b - c.cmf.pen); c.cmf.avail = avail; }
    return avail;
  }
  /* 静かさが未取得の候補の上限(Q=1と仮定)。有望な候補を、静かさの取得前に不当に外さないための比較に使う */
  function upperBound(c) {
    const p = Object.assign({}, c.cmf || {}, { Q: 1 });
    return composite(p, { q: true, h: c.cmf && c.cmf.H != null, v: c.cmf && c.cmf.V != null });
  }

  /* ---- polyline(6桁) と分割 ---- */
  function enc6(pts) {
    let out = '', pa = 0, po = 0;
    const put = (d) => { d = d < 0 ? ~(d << 1) : d << 1; while (d >= 0x20) { out += String.fromCharCode((0x20 | (d & 0x1f)) + 63); d >>= 5; } out += String.fromCharCode(d + 63); };
    for (const p of pts) { const a = Math.round(p[0] * 1e6), b = Math.round(p[1] * 1e6); put(a - pa); put(b - po); pa = a; po = b; }
    return out;
  }
  /* 長いルートは、公開サーバーの制限が未確認のため、一定の長さごとに分けて問い合わせる */
  function chunkPts(pts, maxM) {
    const out = []; let cur = [pts[0]], acc = 0;
    for (let i = 1; i < pts.length; i++) { acc += hv(pts[i - 1], pts[i]); cur.push(pts[i]); if (acc >= maxM && i < pts.length - 1) { out.push(cur); cur = [pts[i]]; acc = 0; } }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  const api = { HEAVY, heavyPenalty, heavyWarn, WEIGHTS, GRADE, ATTRS, NEUTRAL, edgeAccess, trafficIndex, edgeScale, analyzeEdges, edgeSpans, structureRanges, alignedRanges, padRanges, correctZ, gradeProfile, scenicScore, composite, scoreAll, upperBound, enc6, chunkPts, hv };
  if (typeof module !== 'undefined') module.exports = api; else root.Comfort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
