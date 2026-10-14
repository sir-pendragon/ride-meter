const assert = require('assert'); const C = require('../route/comfort.js'); let n = 0; const ok = (c, m) => { assert(c, m); console.log('ok', m); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
// 25m間隔のルート(緯度35.9固定・東へ直進)。経度1度=約90.1km
const mkD = (len, step = 25) => { const la = [], lo = [], s = []; for (let d = 0; d <= len + 1e-9; d += step) { la.push(35.9); lo.push(139 + d / 90110); s.push(d); } return { la, lo, s, total: len }; };
const mkZ = (D, f) => D.s.map(f);

/* 交通指数 */
const E = (o) => Object.assign({ travel_mode: 'bicycle', use: 'road', road_class: 'residential', length: 1 }, o);
ok(C.trafficIndex(E({ use: 'cycleway' })) === 0, '自転車道は0');
ok(near(C.trafficIndex(E({ road_class: 'residential' })), 0.2), '住宅街は0.2');
ok(near(C.trafficIndex(E({ road_class: 'secondary' })), 0.75) && near(C.trafficIndex(E({ road_class: 'primary' })), 0.9) && C.trafficIndex(E({ road_class: 'trunk' })) === 1, '道路種別の値');
ok(near(C.trafficIndex(E({ road_class: 'tertiary', lane_count: 3 })), 0.6), '3車線以上は+0.1');
ok(near(C.trafficIndex(E({ road_class: 'tertiary', speed_limit: 60 })), 0.6), '50km/h以上は+0.1');
ok(near(C.trafficIndex(E({ road_class: 'tertiary', speed_limit: 0 })), 0.5), '速度制限0は補正しない(低速と解釈しない)');
ok(near(C.trafficIndex(E({ road_class: 'tertiary' , speed_limit: undefined })), 0.5), '速度制限の欠損は補正しない');
ok(near(C.trafficIndex(E({ road_class: 'secondary', cycle_lane: 'separated' })), 0.65) && near(C.trafficIndex(E({ road_class: 'secondary', cycle_lane: 'dedicated' })), 0.70), '自転車レーンで下げる');
ok(C.trafficIndex(E({ road_class: 'trunk', lane_count: 4, speed_limit: 80 })) === 1, '上限は1');
ok(C.trafficIndex(E({ use: 'cycleway', cycle_lane: 'separated' })) === 0, '下限は0');
/* 自転車で走れると確認できない辺は評価しない */
ok(C.trafficIndex(E({ travel_mode: 'pedestrian' })) === null && C.edgeAccess(E({ travel_mode: 'pedestrian' })) === 'walk', '押し歩き区間は評価しない');
ok(C.trafficIndex(E({ use: 'steps' })) === null && C.edgeAccess(E({ use: 'ferry' })) === 'walk', '階段・フェリーは評価しない');
ok(C.trafficIndex({ road_class: 'residential', use: 'road', length: 1 }) === null && C.edgeAccess({}) === 'unknown', '通行可否が確認できない辺(travel_modeなし)は評価しない');
ok(C.trafficIndex(E({ road_class: undefined })) === null, '道路種別が不明な辺は評価しない');

/* 静かさ Q */
let a = C.analyzeEdges([E({ use: 'cycleway', length: 3 }), E({ road_class: 'primary', length: 1 })], 4000);
ok(near(a.Q, 1 - (0 + 0.9) / 4) && a.unknownRatio === 0, '加重平均 Q = 1 - ΣL·T/ΣL');
a = C.analyzeEdges([E({ use: 'cycleway', length: 2 }), E({ travel_mode: 'pedestrian', length: 1 }), E({ road_class: undefined, length: 1 })], 4000);
ok(near(a.unknownRatio, 0.5) && near(a.walkRatio, 0.25) && near(a.walkM, 1000, 1e-6), '不明率と押し歩きの割合・距離');
ok(near(a.Q, 1 - (0 + 0.5 + 0.5) / 4), '不明・押し歩きは中立(0.5)で、静かとは数えない');
ok(C.analyzeEdges([], 1000) === null && C.analyzeEdges(null, 1000) === null, '辺がなければ null');
// 単位がメートルでも同じQ
const am = C.analyzeEdges([E({ use: 'cycleway', length: 3000 }), E({ road_class: 'primary', length: 1000 })], 4000);
ok(near(am.Q, 0.775), '辺長の単位(km/m)に左右されない');

/* 橋・トンネルの区間 */
const sp = C.edgeSpans([E({ length: 1 }), E({ length: 0.5, bridge: true }), E({ length: 0.5, tunnel: true }), E({ length: 1 })], 3000);
ok(sp.ok && sp.spans.length === 4 && near(sp.spans[1].a, 1000) && near(sp.spans[2].b, 2000), '辺の区間をルート上の距離に対応づける');
const rg = C.structureRanges(sp.spans); ok(rg.length === 1 && near(rg[0].a, 1000) && near(rg[0].b, 2000), '隣り合う橋・トンネルをまとめる');
ok(C.edgeSpans([E({ length: 1 })], 5000).ok === false, '辺の合計とルート長が25%以上ずれるときは位置の対応に使わない');

/* 勾配ペナルティ */
let D = mkD(2000), z = mkZ(D, s => s * 0.05);
let g = C.gradeProfile(D, z); ok(near(g.H, 1) && g.n15 === 0, '5%一定はペナルティなし');
z = mkZ(D, s => s * 0.10); g = C.gradeProfile(D, z); ok(g.steepM.t1 > 1700 && g.steepM.t2 === 0 && g.H < 1, '10%は重み1の区間');
ok(g.H === 0, '全長が重み1の坂なら、基準K(全長の25%)を超えるので H=0');
z = mkZ(D, s => s * 0.13); g = C.gradeProfile(D, z); ok(g.steepM.t2 > 1700 && g.steepM.t4 === 0, '13%は重み2の区間');
z = mkZ(D, s => s * 0.16); g = C.gradeProfile(D, z); ok(g.steepM.t4 > 1700 && g.n15 === 1 && g.H === 0, '16%は重み4・15%以上が1区間・H=0');
z = mkZ(D, s => 100 - s * 0.16); g = C.gradeProfile(D, z); ok(g.H === 1 && g.n15 === 0, '下りの急勾配は評価しない');
// 境界: 9%ちょうど
z = mkZ(D, s => s * 0.09); g = C.gradeProfile(D, z); ok(g.steepM.t1 > 1700, '9%ちょうどから対象');
z = mkZ(D, s => s * 0.0899); g = C.gradeProfile(D, z); ok(g.steepM.t1 === 0, '9%未満は対象外');
// 100m窓: 100mだけ16%、前後は平坦 → 200m窓の平均は8%(対象外)だが、100m窓で15%以上を検出する
D = mkD(1000); z = mkZ(D, s => s < 400 ? 0 : s < 500 ? (s - 400) * 0.16 : 16);
g = C.gradeProfile(D, z); ok(g.n15 === 1 && g.m15 >= 100 && g.m15 <= 200, '短い急坂は100m窓で検出する');
/* 平坦9.5km + 12%の500m: 重み2の区間が約500m → H = 1 - 2×500/(10000×0.25) = 0.6 前後 */
D = mkD(10000); z = mkZ(D, s => s < 9500 ? 0 : (s - 9500) * 0.12); g = C.gradeProfile(D, z);
ok(g.steepM.t2 > 450 && g.steepM.t2 < 750 && g.H > 0.45 && g.H < 0.65, '混在ルートの区間量とH');
// 異常値(30%超)は件数として数えるが、消さない(最大の重みで評価に残る)
D = mkD(1000); z = mkZ(D, s => s * 0.35); g = C.gradeProfile(D, z); ok(g.anomalies >= 1 && g.n15 === 1 && g.H === 0, '30%超は件数に数えつつ、評価から消さない');

/* 橋・トンネルの補正: 実在する激坂を消さない */
// 谷を渡る橋: DEMが谷底(深さ60m)を拾い、橋の前後で標高が崩れる
D = mkD(1000); const zr = mkZ(D, s => 100 + 0); for (let i = 0; i < D.s.length; i++) if (D.s[i] >= 400 && D.s[i] <= 600) zr[i] = 100 - 60;
let before = C.gradeProfile(D, zr); ok(before.m15 > 0, '補正前は橋の前後で擬似的な急勾配が出る');
let cz = C.correctZ(D, zr, [{ a: 400, b: 600 }]); ok(cz.used === 1 && cz.changed > 0, '橋の区間を補正した');
let after = C.gradeProfile(D, cz.z); ok(after.H === 1 && after.n15 === 0, '補正後は擬似的な急勾配が消える');
// 補正する範囲の外は、1ミリも変えない
ok(zr.every((v, i) => (D.s[i] < 400 || D.s[i] > 600) ? cz.z[i] === v : true), '範囲外の標高は変えない');
// 実在する16%の坂(橋・トンネルではない)は、橋の補正があっても残る
D = mkD(2000); const zs = mkZ(D, s => s < 800 ? 0 : s < 1300 ? (s - 800) * 0.16 : 80); for (let i = 0; i < D.s.length; i++) if (D.s[i] >= 1500 && D.s[i] <= 1700) zs[i] = 80 - 50; // 別の場所に橋(谷底を拾う)
cz = C.correctZ(D, zs, [{ a: 1500, b: 1700 }]); after = C.gradeProfile(D, cz.z);
ok(after.n15 === 1 && after.m15 > 400, '橋を補正しても、別の場所にある実在の激坂は残る');
// トンネル: 山の中を通る(DEMは山頂を拾う)。入口と出口は地面の標高
D = mkD(1000); const zt = mkZ(D, s => 100); for (let i = 0; i < D.s.length; i++) if (D.s[i] > 400 && D.s[i] < 600) zt[i] = 100 + 150;
cz = C.correctZ(D, zt, [{ a: 400, b: 600 }]); ok(Math.max(...cz.z) <= 100 + 1e-9, 'トンネル内の山頂の標高を取り除く');
// 実在する急な登りのトンネル(入口と出口の標高差が大きい)は、直線の平均勾配として残る
D = mkD(1000); const zq = mkZ(D, s => s <= 400 ? 0 : s >= 600 ? 40 : 0 + 999); cz = C.correctZ(D, zq, [{ a: 400, b: 600 }]);
ok(near(cz.z[D.s.indexOf(500)], 20, 1e-6), '急な登りのトンネルは、入口と出口の標高を結ぶ直線(平均勾配)になる');
ok(C.correctZ(D, zq, []).changed === 0 && C.correctZ(D, zq, null).changed === 0, '範囲なしなら変更なし');

/* 景観 */
D = mkD(2000);
const P = (t, lo) => ({ t, lat: 35.9, lon: lo });
let v = C.scenicScore(D, { points: [P('viewpoint', 139.0050), P('peak', 139.0100), P('pass', 139.0150)], lines: [] });
ok(v.points === 3 && v.counts.viewpoint === 1 && v.counts.peak === 1 && v.counts.pass === 1, '近い展望地・山頂・峠を数える');
ok(v.waterShare === 0 && !v.partial && near(v.V, 0.2), '水域なし: V = 0.4×n/(n+3)、3地点で頭打ちにしない');
v = C.scenicScore(D, { points: [{ t: 'viewpoint', lat: 35.95, lon: 139.0 }], lines: [] }); ok(v.points === 0, '遠い展望地(300m超)は数えない');
// 川に沿う: ルートの南60m
const river = [[35.9 - 0.00054, 139.0], [35.9 - 0.00054, 139.0 + 2000 / 90110]];
v = C.scenicScore(D, { points: [], lines: [river] }); ok(v.waterShare > 0.95 && near(v.V, 0.6, 1e-6), '川に沿う100m以内: 割合約100% → V=0.6');
const far = [[35.9 - 0.003, 139.0], [35.9 - 0.003, 139.0 + 2000 / 90110]];
v = C.scenicScore(D, { points: [], lines: [far] }); ok(v.waterShare === 0, '100mより遠い水域は数えない');
v = C.scenicScore(D, { points: [P('viewpoint', 139.005)], lines: null }); ok(v.partial === true && v.waterShare === null && near(v.V, 1 / 4), '水域データなし: 展望地等だけで評価し、partialと明示');
ok(C.scenicScore(D, null) === null, '景観データが取れないときは null(0として扱わない)');

/* 総合スコア */
const mk = (Q, H, V) => ({ cmf: { Q, H, V } });
let cs = [mk(1, 1, 1), mk(0, 0, 0)]; let av = C.scoreAll(cs); ok(near(cs[0].cmf.S, 1) && near(cs[1].cmf.S, 0) && av.q && av.h && av.v, '重み 0.45/0.35/0.20 の合計は1');
cs = [mk(1, 0, 0)]; C.scoreAll(cs); ok(near(cs[0].cmf.S, 0.45), 'Qだけ1なら0.45');
cs = [mk(0, 1, 0)]; C.scoreAll(cs); ok(near(cs[0].cmf.S, 0.35), 'Hだけ1なら0.35');
cs = [mk(0, 0, 1)]; C.scoreAll(cs); ok(near(cs[0].cmf.S, 0.20), 'Vだけ1なら0.20');
cs = [mk(0.8, 0.6, null), mk(0.6, 0.9, null)]; av = C.scoreAll(cs); ok(av.v === false && near(cs[0].cmf.S, (0.45 * 0.8 + 0.35 * 0.6) / 0.8), '景観が未評価なら、静かさと激坂で重みを正規化して比べる');
cs = [mk(0.8, 0.6, 0.5), mk(null, 0.9, 0.5)]; av = C.scoreAll(cs); ok(av.q === false, '一部の候補だけ静かさが取れていないときは、全候補で静かさを使わない(不公平な比較を避ける)');
cs = [mk(0.5, 0.5, 0.5)]; ok(near(C.upperBound(cs[0]) - ((0.45 * 1 + 0.35 * 0.5 + 0.2 * 0.5) / 1), 0), '静かさ未取得の上限は Q=1 と仮定');
ok(C.upperBound({ cmf: { H: 0.5, V: null } }) !== null && near(C.upperBound({ cmf: { H: 0.5 } }), (0.45 + 0.35 * 0.5) / 0.8), '上限: 景観が未評価なら除いて正規化');

/* polyline */
const dec6 = (str) => { let i = 0, la = 0, lo = 0; const o = []; while (i < str.length) { let b, s = 0, r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); la += (r & 1) ? ~(r >> 1) : (r >> 1); s = 0; r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); lo += (r & 1) ? ~(r >> 1) : (r >> 1); o.push([la / 1e6, lo / 1e6]); } return o; };
const pts = [[35.9, 139.08], [35.905123, 139.0912], [35.89, 139.12], [-33.865143, 151.2099]];
const back = dec6(C.enc6(pts)); ok(back.length === 4 && back.every((p, i) => near(p[0], pts[i][0], 1e-6) && near(p[1], pts[i][1], 1e-6)), 'polyline6のエンコードと、既存のデコードが一致(往復)');
const long = []; for (let i = 0; i <= 100; i++) long.push([35.9, 139 + i * 0.005]);
const ch = C.chunkPts(long, 10000); ok(ch.length > 3 && ch[0][ch[0].length - 1] === ch[1][0] && ch.reduce((s, c) => s + c.length - 1, 0) === 100, '長いルートを分割し、境界の点を共有する');
ok(C.chunkPts([[35.9, 139], [35.9, 139.01]], 60000).length === 1, '短いルートは分割しない');
console.log('全 ' + n + ' 件OK (comfort)');
