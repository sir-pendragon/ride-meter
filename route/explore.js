// 共通探索機能(全検索モード共通): 基本検索の結果に改善の余地があるときだけ、自動で経由地・除外点を足して再探索する。
// 通信しない純粋関数だけを置く(通信・描画・保存は index.html 側)。AIは使わない。
// 数値はすべて仮置き。結果は「取得した候補の中の最良」であり、最適解を保証しない。
//  - 通常検索は /route 1回(経由地なしなら代替ルート最大2本)。追加探索は最大3回までで、段階的に打ち切る。
//  - 利用者が指定した地点は動かさない。自動の経由地は、その間にだけ足す。
//  - 経由地は、自転車で通れる道に載ることを /locate で確認できたものだけを使う(確認できないものは捨てる)。
(function (root) {
  'use strict';
  const CFG = {
    routeMax: 3,          // 追加の /route の合計(通行止めによる再計算も同じ枠で数える)
    stageMax: 2,          // 段階の数。1段階目は最大2本、2段階目は最大1本
    timeMs: 20000,        // 追加探索の制限時間
    slowMs: 8000,         // 1回の応答がこれを超えたら、以後の拡張を止める
    capNormal: 1.5,       // 最小獲得標高・自転車ルート優先・快適・絶景: 最短の1.5倍まで
    capAutoMax: 2.0,      // 最大獲得標高: 基本候補は上限なし。自動で足した候補だけ、内部的に最短の2倍まで
    maxItems: 3,          // 1つの提案に入れる経由地・除外点の数の上限
    userGapM: 300,        // 利用者の地点の近くには、除外点を置かない
    snapM: 35,            // 経由地は、道路に35m以内で載るものだけ
    corridorDeg: { lat: 0.12, lon: 0.15 }, // 峠を探す範囲(利用者の地点の外側。約13km)
    passMinGainM: 100,    // 峠は、基本ルートの該当位置より100m以上高いものだけ
    minWindowG: { min: 0.06, cmf: 0.09 },  // 除外点にする急坂の下限(200m窓)
    busyT: 0.75, busyMinM: 400,            // 静かさ: 交通指数が高く、400m以上続く区間に除外点
    quiet: { heavyMinM: 3000, radiusM: 12000, minSepM: 3000, n: 2 }, // 幹線道路が3km以上続くとき、その周辺12km以内の峠・鞍部を、迂回の経由地の候補にする(最大2か所)
    scenicMaxFromRouteM: 1500,             // 景観: ルートからの距離の上限
    dupOverlap: 0.9, dupM: 30,             // 他の候補と30m以内で90%以上重なるものは重複
    improve: { max: { abs: 50, rel: 0.05 }, min: { abs: 30, rel: 0.05 }, cyc: { abs: 0.05 }, cmf: { abs: 0.03 } }
  };
  const rad = Math.PI / 180;
  const hv = (a, b) => { const dl = (b[0] - a[0]) * rad, dg = (b[1] - a[1]) * rad; const s = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dg / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s))); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function pointAt(D, s) {
    let i = 0; while (i < D.s.length - 1 && D.s[i + 1] < s) i++;
    const j = Math.min(D.s.length - 1, i + 1), d = D.s[j] - D.s[i], f = d > 0 ? clamp((s - D.s[i]) / d, 0, 1) : 0;
    return { lat: D.la[i] + (D.la[j] - D.la[i]) * f, lon: D.lo[i] + (D.lo[j] - D.lo[i]) * f };
  }
  function nearest(D, p, from) {
    let bi = from || 0, bd = Infinity;
    for (let i = from || 0; i < D.la.length; i++) { const d = hv([D.la[i], D.lo[i]], [p.lat, p.lon]); if (d < bd) { bd = d; bi = i; } }
    return { i: bi, d: bd };
  }
  /* 利用者の地点が、ルート上のどの距離にあたるか(並びを保つ) */
  function userSpans(D, userPts) {
    const out = []; let from = 0;
    userPts.forEach((p, k) => { if (k === 0) { out.push(0); return; } if (k === userPts.length - 1) { out.push(D.s[D.s.length - 1]); return; } const r = nearest(D, p, from); from = r.i; out.push(D.s[r.i]); });
    return out;
  }
  function gapOf(us, s) { for (let i = 0; i < us.length - 1; i++) if (s >= us[i] && s <= us[i + 1]) return i; return Math.max(0, us.length - 2); }
  /* 経由地を、ルート上の位置の順に、利用者の地点の間へ入れる。locations は Valhalla の形式 */
  function insertVia(userPts, D, wps) {
    const us = userSpans(D, userPts), items = (wps || []).map(w => ({ w, s: D.s[nearest(D, w, 0).i] })).sort((a, b) => a.s - b.s);
    const out = [];
    userPts.forEach((p, k) => {
      out.push({ lat: p.lat, lon: p.lon, type: (k === 0 || k === userPts.length - 1) ? 'break' : 'through' });
      if (k < userPts.length - 1) for (const it of items) if (gapOf(us, it.s) === k) out.push({ lat: it.w.lat, lon: it.w.lon, type: 'through' });
    });
    return out;
  }
  /* a のうち、b の30m以内にある点の割合(重なり率) */
  function overlap(a, b, m) {
    const G = 0.0004, idx = new Map(), cell = (la, lo) => Math.floor(la / G) + ',' + Math.floor(lo / G);
    for (let i = 0; i < b.la.length; i++) { const k = cell(b.la[i], b.lo[i]); (idx.get(k) || idx.set(k, []).get(k)).push([b.la[i], b.lo[i]]); }
    let hit = 0;
    for (let i = 0; i < a.la.length; i++) { const x = Math.floor(a.la[i] / G), y = Math.floor(a.lo[i] / G); let f = false; for (let p = -1; p <= 1 && !f; p++) for (let q = -1; q <= 1 && !f; q++) { const l = idx.get((x + p) + ',' + (y + q)); if (l) for (const c of l) if (hv([a.la[i], a.lo[i]], c) <= (m || CFG.dupM)) { f = true; break; } } if (f) hit++; }
    return a.la.length ? hit / a.la.length : 0;
  }
  const isDup = (D, existing) => existing.some(c => c.D && overlap(D, c.D) >= CFG.dupOverlap && overlap(c.D, D) >= CFG.dupOverlap);

  /* ---- 急坂の窓(除外点の候補) ---- */
  function steepWindows(D, z, minG, userS) {
    const n = z.length, W = 200, ws = []; let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (j < i) j = i; while (j < n - 1 && D.s[j] - D.s[i] < W) j++;
      const dd = D.s[j] - D.s[i]; if (dd < W * 0.9) break;
      const g = (z[j] - z[i]) / dd; if (g >= minG) ws.push({ a: D.s[i], b: D.s[j], g, mid: (D.s[i] + D.s[j]) / 2 });
    }
    ws.sort((p, q) => q.g - p.g);
    const out = [];
    for (const w of ws) { if (out.some(o => Math.abs(o.mid - w.mid) < 400)) continue; if ((userS || []).some(u => Math.abs(u - w.mid) < CFG.userGapM)) continue; out.push(w); if (out.length >= CFG.maxItems) break; }
    return out.map(w => Object.assign({ pt: pointAt(D, w.mid) }, w));
  }
  /* 交通指数が高く、400m以上続く区間(静かさ用の除外点) */
  function busySpans(spans, D, userS) {
    const out = []; let run = null;
    for (const s of (spans || [])) { if (s.T != null && s.T >= CFG.busyT) { if (run && Math.abs(run.b - s.a) < 1) run.b = s.b; else { run = { a: s.a, b: s.b }; out.push(run); } } else run = null; }
    return out.filter(r => r.b - r.a >= CFG.busyMinM).map(r => ({ a: r.a, b: r.b, len: r.b - r.a, mid: (r.a + r.b) / 2 })).filter(r => !(userS || []).some(u => Math.abs(u - r.mid) < CFG.userGapM)).sort((p, q) => q.len - p.len).slice(0, CFG.maxItems).map(r => Object.assign({ pt: pointAt(D, r.mid) }, r));
  }

  /* ---- 経由地の候補(迂回の見込み・道路係数つき) ---- */
  function roadFactor(best, userPts) {
    let straight = 0; for (let i = 1; i < userPts.length; i++) straight += hv([userPts[i - 1].lat, userPts[i - 1].lon], [userPts[i].lat, userPts[i].lon]);
    return straight > 0 ? clamp(best.len / straight, 1.1, 2.0) : 1.3;
  }
  function detourEst(D, us, userPts, P, rf) { // その地点を経由したときの、追加距離の見込み(m)
    const r = nearest(D, P, 0), k = gapOf(us, D.s[r.i]), a = userPts[k], b = userPts[k + 1] || userPts[k];
    const pa = [a.lat, a.lon], pb = [b.lat, b.lon], pp = [P.lat, P.lon];
    return Math.max(0, (hv(pa, pp) + hv(pp, pb) - hv(pa, pb)) * rf);
  }
  /* 最大獲得標高: 峠・鞍部・山頂。基本ルートのその位置より100m以上高いものを、(追加の登り÷追加の距離)の順に */
  function passItems(ctx) {
    const { best, userPts, minLen, passes } = ctx; if (!passes || !passes.length || !best.m || !best.m.z) return [];
    const D = best.D, z = best.m.z, us = userSpans(D, userPts), rf = roadFactor(best, userPts), cap = minLen * CFG.capAutoMax, out = [];
    for (const p of passes) {
      const ele = Number(p.ele); if (!Number.isFinite(ele)) continue;
      const r = nearest(D, p, 0); if (r.d > 15000) continue;
      const dG = ele - z[r.i]; if (dG < CFG.passMinGainM) continue;
      const dL = detourEst(D, us, userPts, p, rf); if (best.len + dL > cap) continue;
      out.push({ pt: { lat: p.lat, lon: p.lon }, dG, dL, ratio: dG / Math.max(500, dL), s: D.s[r.i], name: p.name || '' });
    }
    out.sort((a, b) => b.ratio - a.ratio);
    const pick = []; for (const o of out) { if (pick.some(q => Math.abs(q.s - o.s) < 3000)) continue; pick.push(o); if (pick.length >= CFG.maxItems) break; }
    return pick;
  }
  /* 自転車ルート優先: 登録された自転車ルートのうち、まだ沿っていない長い道。入口と出口を経由地にする */
  function cycItems(ctx) {
    const { best, userPts, minLen, ways } = ctx; if (!ways || !ways.length) return [];
    const D = best.D, us = userSpans(D, userPts), rf = roadFactor(best, userPts), cap = minLen * CFG.capNormal, out = [];
    for (const w of ways) {
      if (!w || w.length < 2) continue;
      let len = 0; for (let i = 1; i < w.length; i++) len += hv(w[i - 1], w[i]); if (len < 1000) continue;
      const mid = { lat: w[Math.floor(w.length / 2)][0], lon: w[Math.floor(w.length / 2)][1] }, r = nearest(D, mid, 0);
      if (r.d < 60 || r.d > 3000) continue;
      const a = { lat: w[0][0], lon: w[0][1] }, b = { lat: w[w.length - 1][0], lon: w[w.length - 1][1] };
      const dL = detourEst(D, us, userPts, mid, rf); if (best.len + dL > cap) continue;
      out.push({ pts: [a, b], len, dL, ratio: len / Math.max(500, dL), s: D.s[r.i] });
    }
    out.sort((p, q) => q.ratio - p.ratio);
    const pick = []; for (const o of out) { if (pick.some(q => Math.abs(q.s - o.s) < 3000)) continue; pick.push(o); if (pick.length >= CFG.maxItems) break; }
    return pick;
  }
  /* 快適・絶景: 幹線道路(trunk/primary)が長く続くとき、その周辺の峠・鞍部を、迂回の経由地の候補にする。
     迂回の見込み距離が上限内のものだけ、追加距離の小さい順。実際に静かか・激坂でないかは、ルートを作ってから採点する */
  const HEAVY_RC = new Set(['trunk', 'primary', 'motorway']);
  function quietItems(ctx) {
    const { best, userPts, minLen, passes } = ctx, cm = best.cmf || {}; if (!passes || !passes.length || !cm.spans || !(cm.heavyM >= CFG.quiet.heavyMinM)) return [];
    const D = best.D; let run = null, bestRun = null;
    for (const sp of cm.spans) { if (HEAVY_RC.has(sp.rc)) { if (run && Math.abs(run.b - sp.a) < 1) run.b = sp.b; else { run = { a: sp.a, b: sp.b }; } if (!bestRun || run.b - run.a > bestRun.b - bestRun.a) bestRun = run; } else run = null; }
    if (!bestRun) return [];
    const mid = pointAt(D, (bestRun.a + bestRun.b) / 2), us = userSpans(D, userPts), rf = roadFactor(best, userPts), cap = minLen * CFG.capNormal, out = [];
    for (const p of passes) {
      if (p.k === 'peak') continue;
      if (hv([mid.lat, mid.lon], [p.lat, p.lon]) > CFG.quiet.radiusM) continue;
      const r = nearest(D, p, 0); if (r.d <= 300) continue; // すでにルート上にある
      const dL = detourEst(D, us, userPts, p, rf); if (best.len + dL > cap) continue;
      out.push({ pt: { lat: p.lat, lon: p.lon }, dL, name: p.name || '' });
    }
    out.sort((a, b) => a.dL - b.dL);
    const pick = []; for (const o of out) { if (pick.some(q => hv([q.pt.lat, q.pt.lon], [o.pt.lat, o.pt.lon]) < CFG.quiet.minSepM)) continue; pick.push(o); if (pick.length >= CFG.quiet.n) break; }
    return pick;
  }
  /* 快適・絶景: ルートの近くにある展望地・山頂・峠。追加距離が小さいものから */
  function scenicItems(ctx) {
    const { best, userPts, minLen, feat } = ctx; if (!feat || !feat.points || !feat.points.length) return [];
    const D = best.D, us = userSpans(D, userPts), rf = roadFactor(best, userPts), cap = minLen * CFG.capNormal, out = [];
    for (const p of feat.points) {
      const r = nearest(D, p, 0); if (r.d <= 300 || r.d > CFG.scenicMaxFromRouteM) continue;
      const dL = detourEst(D, us, userPts, p, rf); if (best.len + dL > cap) continue;
      out.push({ pt: { lat: p.lat, lon: p.lon }, dL, s: D.s[r.i], t: p.t });
    }
    out.sort((a, b) => a.dL - b.dL);
    const pick = []; for (const o of out) { if (pick.some(q => Math.abs(q.s - o.s) < 2000)) continue; pick.push(o); if (pick.length >= CFG.maxItems) break; }
    return pick;
  }

  /* ---- 拡張するかどうか(改善の余地) ---- */
  function families(ctx) {
    const { mode, best } = ctx, userS = ctx.userS || userSpans(best.D, ctx.userPts), fam = [];
    const z = best.m && best.m.z;
    if (mode === 'min') { if (z) { const it = steepWindows(best.D, z, CFG.minWindowG.min, userS); if (it.length) fam.push({ fam: 'steep', kind: 'exclude', loss: 1, items: it.map(x => ({ pt: x.pt, g: x.g })) }); } }
    else if (mode === 'max') { const it = passItems(ctx); if (it.length) fam.push({ fam: 'pass', kind: 'via', loss: 1, items: it }); }
    else if (mode === 'cyc') { const it = cycItems(ctx); if (it.length) fam.push({ fam: 'cyc', kind: 'via', loss: 1, items: it }); }
    else if (mode === 'cmf') {
      const c = best.cmf || {}, loss = { steep: 0.35 * (1 - (c.H == null ? 1 : c.H)), busy: 0.45 * (1 - (c.Q == null ? 1 : c.Q)), scenic: 0.20 * (1 - (c.V == null ? 1 : c.V)) };
      if (z && best.cmf && best.cmf.H != null && best.cmf.H < 1) { const it = steepWindows(best.D, z, CFG.minWindowG.cmf, userS); if (it.length) fam.push({ fam: 'steep', kind: 'exclude', loss: loss.steep, items: it.map(x => ({ pt: x.pt, g: x.g })) }); }
      if (c.spans && c.Q != null && c.Q < 1) { const it = busySpans(c.spans, best.D, userS); if (it.length) fam.push({ fam: 'busy', kind: 'exclude', loss: loss.busy, items: it.map(x => ({ pt: x.pt, len: x.len })) }); }
      { const it = quietItems(ctx); it.forEach((x, i) => fam.push({ fam: 'quiet' + (i + 1), kind: 'via', loss: loss.busy + 0.02 - i * 0.001, items: [x] })); } // 幹線道路を避ける迂回: 1か所ずつ別の案(組み合わせない)
      if (ctx.feat && c.V != null && c.V < 1) { const it = scenicItems(ctx); if (it.length) fam.push({ fam: 'scenic', kind: 'via', loss: loss.scenic, items: it }); }
    }
    return fam.sort((a, b) => b.loss - a.loss);
  }
  /* 経由地(via)の候補を、/locate で確認するために平らにして返す */
  function viaPoints(fams) { const out = []; for (const f of fams) if (f.kind === 'via') for (const it of f.items) { if (it.pts) out.push(...it.pts); else out.push(it.pt); } return out; }
  /* 確認できた点だけを残す。ok は「点 → 通れる」の判定関数。via系の項目は、点が1つでも確認できなければ捨てる */
  function filterVerified(fams, ok) {
    return fams.map(f => f.kind !== 'via' ? f : Object.assign({}, f, { items: f.items.filter(it => (it.pts || [it.pt]).every(ok)) })).filter(f => f.items.length);
  }
  function mkProposal(f, n) {
    const its = f.items.slice(0, n), p = { id: f.fam + n, fam: f.fam, kind: f.kind, n, excl: [], via: [] };
    if (f.kind === 'exclude') p.excl = its.map(i => i.pt); else for (const i of its) { if (i.pts) p.via.push(...i.pts); else p.via.push(i.pt); }
    return p;
  }
  /* 1段階目: 最大2本。最も損の大きい系統を優先する。系統が1つだけなら、1項目版と2項目版 */
  function firstProposals(fams) {
    if (!fams.length) return [];
    if (fams.length >= 2) return [mkProposal(fams[0], 1), mkProposal(fams[1], 1)];
    const f = fams[0], out = [mkProposal(f, 1)]; if (f.items.length >= 2) out.push(mkProposal(f, 2)); return out;
  }
  /* 2段階目: 最良だった提案に、項目を1つ足す(最大 maxItems)。足せなければなし */
  function refineProposal(fams, bestProp) {
    if (!bestProp) return null; const f = fams.find(x => x.fam === bestProp.fam); if (!f) return null;
    const n = bestProp.n + 1; if (n > CFG.maxItems || f.items.length < n) return null;
    return mkProposal(f, n);
  }

  /* ---- 評価の値と、改善の判定 ---- */
  function valueOf(mode, c) {
    if (mode === 'max' || mode === 'min') return c.gain == null ? null : c.gain;
    if (mode === 'cyc') return c.cyc == null ? null : c.cyc;
    if (mode === 'cmf') return c.cmf && c.cmf.S != null ? c.cmf.S : null;
    return null;
  }
  function improved(mode, nv, ov) {
    if (nv == null) return false; if (ov == null) return true;
    const t = CFG.improve[mode]; if (!t) return false;
    if (mode === 'max') return nv - ov >= Math.max(t.abs, Math.abs(ov) * t.rel);
    if (mode === 'min') return ov - nv >= Math.max(t.abs, Math.abs(ov) * t.rel);
    return nv - ov >= t.abs;
  }
  /* 候補の距離の上限。基本候補は、モードごとの既存の条件(最大獲得標高は上限なし)。自動で足した候補は、最大獲得標高も2倍まで */
  function capFor(mode, auto) { if (mode === 'max') return auto ? CFG.capAutoMax : Infinity; return CFG.capNormal; }

  /* ---- 予算(回数・時間) ---- */
  function Budget(opt) {
    const o = Object.assign({ routeLeft: CFG.routeMax, now: Date.now }, opt || {});
    this.routeLeft = Math.max(0, o.routeLeft); this.now = o.now; this.t0 = this.now(); this.slow = false; this.stages = 0;
  }
  Budget.prototype.timeUp = function () { return this.now() - this.t0 >= CFG.timeMs; };
  Budget.prototype.canStage = function (n) { return this.stages < CFG.stageMax && this.routeLeft >= (n || 1) && !this.timeUp() && !this.slow; };
  Budget.prototype.use = function (n, ms) { this.routeLeft -= n; this.stages++; if (ms > CFG.slowMs) this.slow = true; };

  const api = { CFG, pointAt, nearest, userSpans, insertVia, overlap, isDup, steepWindows, busySpans, passItems, cycItems, scenicItems, quietItems, families, viaPoints, filterVerified, mkProposal, firstProposals, refineProposal, valueOf, improved, capFor, Budget, roadFactor };
  if (typeof module !== 'undefined') module.exports = api; else root.Explore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
