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
  const NEUTRAL = 0.5; // 不明な辺の交通指数(静かとも多いとも言わない)
  const ATTRS = ['shape', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.surface', 'edge.length', 'edge.road_class', 'edge.use', 'edge.lane_count', 'edge.speed_limit', 'edge.cycle_lane', 'edge.bridge', 'edge.tunnel', 'edge.travel_mode'];

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
    let sumT = 0, unk = 0, walk = 0, known = 0;
    for (const e of edges) {
      const L = Math.max(0, Number(e.length) || 0); if (!L) continue;
      const a = edgeAccess(e), t = trafficIndex(e);
      if (a === 'walk') { walk += L; unk += L; sumT += L * NEUTRAL; }
      else if (t == null) { unk += L; sumT += L * NEUTRAL; }
      else { known += L; sumT += L * t; }
    }
    return { Q: clamp(1 - sumT / tot, 0, 1), unknownRatio: unk / tot, walkRatio: walk / tot, walkM: walk / tot * (routeM || tot * scale), knownRatio: known / tot, n: edges.length };
  }
  /* 辺ごとの区間(ルート上の距離 m)。橋・トンネルの補正、交通指数が高い区間の検出に使う */
  function edgeSpans(edges, routeM) {
    if (edges && edges.length && edges.every(e => Number.isFinite(e._a) && Number.isFinite(e._b) && e._b >= e._a)) {
      return { ok: true, spans: edges.map(e => ({ a: e._a, b: e._b, T: trafficIndex(e), access: edgeAccess(e), bridge: e.bridge === true, tunnel: e.tunnel === true, rc: e.road_class || null, use: e.use || null })) };
    }
    const { tot, scale, ok } = edgeScale(edges, routeM);
    if (!ok) return { ok: false, spans: [] };
    const spans = []; let acc = 0;
    for (const e of edges) {
      const L = Math.max(0, Number(e.length) || 0) * scale; if (!L) continue;
      spans.push({ a: acc, b: acc + L, T: trafficIndex(e), access: edgeAccess(e), bridge: e._verified === undefined && e.bridge === true, tunnel: e._verified === undefined && e.tunnel === true, rc: e.road_class || null, use: e.use || null });
      acc += L;
    }
    return { ok: true, spans };
  }
  function structureRanges(spans) {
    const out = [];
    for (const s of spans) if (s.bridge || s.tunnel) { const l = out[out.length - 1]; if (l && Math.abs(l.b - s.a) < 1) l.b = s.b; else out.push({ a: s.a, b: s.b }); }
    return out;
  }
  // trace_attributes が経由地の重複頂点などを整理しても、同じ形状であることを両方向で確認する。
  // 1m超のずれ・逆行・大きな頂点飛ばしは補正しない。各点の探索は最大64辺に限定する。
  function tracePositions(route, matched) {
    if (!route || !matched || route.length < 2 || matched.length < 2 || hv(route[0],matched[0])>1 || hv(route[route.length-1],matched[matched.length-1])>1) return null;
    function project(points, target) {
      const dist=[0];for(let i=1;i<target.length;i++)dist.push(dist[i-1]+hv(target[i-1],target[i]));
      const out=[];let at=0,last=0;
      for(const p of points){let best=null;
        for(let j=at;j<Math.min(target.length-1,at+64);j++){
          const a=target[j],b=target[j+1],cos=Math.cos(p[0]*rad),x=(b[1]-a[1])*cos,y=b[0]-a[0],den=x*x+y*y;
          let t=den?clamp(((p[1]-a[1])*cos*x+(p[0]-a[0])*y)/den,0,1):0;
          const ds=dist[j+1]-dist[j];if(j===at&&ds>0)t=Math.max(t,clamp((last-dist[j])/ds,0,1));
          const q=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],d=hv(p,q),s=dist[j]+ds*t;
          if(!best||d<best.d-1e-6)best={d,s,j};
        }
        if(!best||best.d>1||best.s<last-0.01)return null;
        out.push(best.s);at=best.j;last=best.s;
      }
      return out;
    }
    const positions=project(matched,route);return positions&&project(route,matched)?positions:null;
  }
  /* 橋・トンネルの区間だけ、区間の両端のすぐ外側(区間の外で最も近い標高点)の標高を直線で結ぶ。それ以外の区間(実在する激坂を含む)には触れない */
  function correctZ(D, z, ranges) {
    const out = z.slice(); let changed = 0, used = 0;
    for (const r of ranges || []) {
      if (!Number.isFinite(r.a) || !Number.isFinite(r.b) || r.a < 0 || r.b > D.s[D.s.length - 1] || r.b <= r.a) continue;
      let ia = -1, ib = -1;
      for (let i = 0; i < D.s.length; i++) { if (D.s[i] < r.a) ia = i; if (D.s[i] > r.b) { ib = i; break; } }
      // 両端の外側にDEM点がない構造物は、地面の高さを端点と断定できない。
      if (ia < 0 || ib < 0) continue;
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
  function nearAny(idx, cell, p, r) { const a = Math.floor(p[0] / cell), b = Math.floor(p[1] / cell), dx = Math.ceil(r / 111195 / cell), dy = Math.ceil(r / (111195 * Math.max(0.01, Math.cos(p[0] * rad))) / cell); for (let x = -dx; x <= dx; x++) for (let y = -dy; y <= dy; y++) { const l = idx.get((a + x) + ',' + (b + y)); if (l) for (const q of l) if (hv(p, q) <= r) return true; } return false; }
  const POINT_R = 300, WATER_R = 100, CELL = 0.0015;
  function scenicScore(D, feat) {
    if (!feat) return null;
    const rp = []; for (let i = 0; i < D.la.length; i++) rp.push([D.la[i], D.lo[i]]);
    const cnt = { viewpoint: 0, peak: 0, pass: 0 }; let nPts = 0;
    if (feat.points && feat.points.length) {
      const idx = gridIndex(rp, CELL);
      for (const f of feat.points) if (nearAny(idx, CELL, [f.lat, f.lon], POINT_R)) { nPts++; if (cnt[f.t] != null) cnt[f.t]++; }
    }
    // 3地点で頭打ちにしない。件数の増加に伴って緩やかに1へ近づける固定基準。
    const pointScore = nPts / (nPts + 3);
    let share = null, V = pointScore, partial = true;
    if (feat.lines) {
      partial = false;
      const wp = []; for (const w of feat.lines) if (w && w.length > 1) for (const p of densifyLL(w, 25)) wp.push(p);
      if (wp.length) { const idx = gridIndex(wp, CELL); let hit = 0; for (const p of rp) if (nearAny(idx, CELL, p, WATER_R)) hit++; share = rp.length ? hit / rp.length : 0; } else share = 0;
      V = 0.4 * pointScore + 0.6 * share;
    }
    return { V: clamp(V, 0, 1), points: nPts, counts: cnt, waterShare: share, partial };
  }

  /* ---- 総合スコア: 全候補で評価できた指標だけで重みを正規化して比べる(一部の候補だけ指標がある状態では比べない) ---- */
  function composite(parts, avail) {
    let w = 0, s = 0;
    for (const k of ['q', 'h', 'v']) { const v = parts[k.toUpperCase()]; if (avail[k] && v != null) { w += WEIGHTS[k]; s += WEIGHTS[k] * v; } }
    return w > 0 ? s / w : null;
  }
  function scoreAll(cands) {
    const has = (c, k) => c.cmf && c.cmf[k] != null;
    const avail = { q: cands.length > 0 && cands.every(c => has(c, 'Q')), h: cands.length > 0 && cands.every(c => has(c, 'H')), v: cands.length > 0 && cands.every(c => has(c, 'V')) };
    for (const c of cands) { if (!c.cmf) c.cmf = {}; c.cmf.S = composite(c.cmf, avail); c.cmf.avail = avail; }
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

  const api = { WEIGHTS, GRADE, ATTRS, NEUTRAL, edgeAccess, trafficIndex, edgeScale, analyzeEdges, edgeSpans, structureRanges, tracePositions, correctZ, gradeProfile, scenicScore, composite, scoreAll, upperBound, enc6, chunkPts, hv };
  if (typeof module !== 'undefined') module.exports = api; else root.Comfort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
