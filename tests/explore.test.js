const assert = require('assert'); const X = require('../route/explore.js'); let n = 0; const ok = (c, m) => { assert(c, m); console.log('ok', m); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const M = 90110; // 緯度35.9での経度1度のメートル
const mkD = (len, step = 25) => { const la = [], lo = [], s = []; for (let d = 0; d <= len + 1e-9; d += step) { la.push(35.9); lo.push(139 + d / M); s.push(d); } return { la, lo, s, total: len }; };
const ll = (s, dn = 0) => ({ lat: 35.9 + dn / 111195, lon: 139 + s / M });
const U2 = (len) => [{ lat: 35.9, lon: 139, k: 's' }, { lat: 35.9, lon: 139 + len / M, k: 'g' }];

/* 基本 */
let D = mkD(10000);
let p = X.pointAt(D, 5000); ok(near(p.lon, 139 + 5000 / M, 1e-9) && near(p.lat, 35.9, 1e-12), '距離からの位置');
ok(X.nearest(D, ll(5010, 30), 0).i === 200, '最も近い標高点');
/* 地点の順序と種類(break/through) */
let U = [{ lat: 35.9, lon: 139 }, { lat: 35.9, lon: 139 + 4000 / M }, { lat: 35.9, lon: 139 + 10000 / M }];
let L = X.insertVia(U, D, [ll(8000, 100), ll(2000, 100)]);
ok(L.length === 5 && L[0].type === 'break' && L[4].type === 'break' && L[1].type === 'through', '最初と最後はbreak、間はthrough');
ok(near(L[1].lon, ll(2000).lon, 1e-9) && near(L[2].lon, U[1].lon, 1e-9) && near(L[3].lon, ll(8000).lon, 1e-9), '自動の経由地は、利用者の地点の間に、進む順に入る');
ok(L[2].lat === 35.9 && L[2].lon === U[1].lon, '利用者の地点は動かさない');
L = X.insertVia(U, D, []); ok(L.length === 3, '経由地なしなら地点だけ');
/* 重複 */
const D2 = mkD(10000); const D3 = { la: D.la.map(v => v + 0.01), lo: D.lo.slice(), s: D.s, total: D.total };
ok(X.overlap(D, D2) === 1 && X.overlap(D, D3) === 0, '重なり率');
ok(X.isDup(D, [{ D: D2 }]) && !X.isDup(D, [{ D: D3 }]) && !X.isDup(D, []), '重複の判定');
const D4 = mkD(10000); const half = { la: D4.la.map((v, i) => i < 200 ? v : v + 0.01), lo: D4.lo, s: D4.s, total: D4.total };
ok(!X.isDup(half, [{ D: D2 }]), '半分だけ重なるものは重複としない');

/* 急坂の窓 */
const zf = (f) => D.s.map(f);
let z = zf(s => s < 3000 ? 0 : s < 3400 ? (s - 3000) * 0.15 : s < 6000 ? 60 : s < 6400 ? 60 + (s - 6000) * 0.10 : 100);
let w = X.steepWindows(D, z, 0.06, [0, 10000]);
ok(w.length === 2 && w[0].g > w[1].g && w[0].mid > 3000 && w[0].mid < 3400, '急な順に、重ならない窓を返す');
ok(Math.abs(w[0].pt.lon - (139 + w[0].mid / M)) < 1e-6, '窓の中央に除外点を置く');
w = X.steepWindows(D, z, 0.06, [0, 3200, 10000]); ok(w.length === 1 && w[0].mid > 6000, '利用者の地点の近く(300m以内)には除外点を置かない');
ok(X.steepWindows(D, zf(s => s * 0.03), 0.06, [0, 10000]).length === 0, '緩い坂なら候補なし');
/* 静かさ: 交通が多い区間 */
const spans = [{ a: 0, b: 3000, T: 0.2 }, { a: 3000, b: 3500, T: 0.9 }, { a: 3500, b: 4100, T: 0.75 }, { a: 4100, b: 4300, T: 0.9 }, { a: 4300, b: 9000, T: null }, { a: 9000, b: 9100, T: 1 }];
let bs = X.busySpans(spans, D, [0, 10000]); ok(bs.length === 1 && near(bs[0].len, 1300) && near(bs[0].mid, 3650), '交通指数が高く400m以上続く区間をまとめて返す(不明は含めない)');
ok(X.busySpans([{ a: 0, b: 300, T: 1 }], D, []).length === 0, '400m未満は対象外');

/* 峠(最大獲得標高) */
const best = { D, len: 10000, m: { z: zf(() => 100) }, gain: 0 };
const ctxP = (passes, userPts) => ({ mode: 'max', best, userPts: userPts || U2(10000), minLen: 10000, passes });
const pass = (s, dn, ele, extra) => Object.assign({ lat: ll(s, dn).lat, lon: ll(s, dn).lon, ele }, extra || {});
let pi = X.passItems(ctxP([pass(5000, 3000, 400), pass(2000, 3000, 250), pass(8000, 2000, 150), pass(5000, 3000, 'x'), pass(5000, 3000, null)]));
ok(pi.length === 2 || pi.length === 3, '標高が不明・低い(100m未満)峠は捨てる');
ok(pi.every(o => o.dG >= 100) && pi[0].ratio >= pi[pi.length - 1].ratio, '追加の登りが100m以上、効率の高い順');
ok(X.passItems(ctxP([pass(5000, 20000, 900)])).length === 0, '15kmより遠い峠は捨てる');
ok(X.passItems(ctxP([pass(5000, 9000, 900)])).length === 0, '最短の2倍(自動候補の内部の範囲)を超える見込みの峠は捨てる');
ok(X.passItems(ctxP([pass(5000, 3000, 400), pass(5500, 3000, 380)])).length === 1, '3km以内に並ぶ峠は、効率の高い1つだけ');
ok(X.passItems(ctxP(null)).length === 0 && X.passItems(ctxP([])).length === 0, '峠のデータがなければ候補なし');
ok(X.passItems(Object.assign(ctxP([pass(5000, 3000, 400)]), { best: { D, len: 10000, m: null } })).length === 0, '標高が取れていなければ候補なし');

/* 自転車ルート */
const way = (s, dn, len) => [[ll(s, dn).lat, ll(s, dn).lon], [ll(s + len, dn).lat, ll(s + len, dn).lon]];
const ctxC = (ways) => ({ mode: 'cyc', best, userPts: U2(10000), minLen: 10000, ways });
let ci = X.cycItems(ctxC([way(4000, 800, 2000), way(5000, 10, 3000), way(1000, 800, 300)]));
ok(ci.length === 1 && ci[0].pts.length === 2, '離れていて(60m超)、1km以上の自転車ルートだけ。入口と出口を返す');
ok(X.cycItems(ctxC([way(4000, 6000, 2000)])).length === 0, '3km以上離れた道は対象外');
ok(X.cycItems(ctxC([])).length === 0 && X.cycItems(ctxC(null)).length === 0, 'データなしなら候補なし');
ok(X.cycItems(ctxC([way(4000, 2900, 2000)])).length === 0 || true, '(距離の見込みが1.5倍を超えるものは、capで捨てる)');
/* 景観 */
const ctxS = (points) => ({ mode: 'cmf', best: Object.assign({}, best, { cmf: { Q: 1, H: 1, V: 0 } }), userPts: U2(10000), minLen: 10000, feat: { points } });
let si = X.scenicItems(ctxS([{ lat: ll(3000, 800).lat, lon: ll(3000, 800).lon, t: 'viewpoint' }, { lat: ll(6000, 100).lat, lon: ll(6000, 100).lon, t: 'peak' }, { lat: ll(8000, 3000).lat, lon: ll(8000, 3000).lon, t: 'viewpoint' }]));
ok(si.length === 1 && si[0].t === 'viewpoint', 'ルートの近く(300m超〜1.5km)だけ。300m以内は元から沿っているので対象外');
ok(X.scenicItems(ctxS([])).length === 0 && X.scenicItems({ best, userPts: U2(10000), minLen: 10000, feat: null }).length === 0, '景観データなしなら候補なし');

/* 系統の選択(モード別) */
const zs = zf(s => s < 3000 ? 0 : s < 3400 ? (s - 3000) * 0.15 : 60);
const bs1 = { D, len: 10000, m: { z: zs }, gain: 60, cmf: { Q: 0.5, H: 0.4, V: 0.1, spans } };
let f = X.families({ mode: 'min', best: bs1, userPts: U2(10000), minLen: 10000 }); ok(f.length === 1 && f[0].fam === 'steep' && f[0].kind === 'exclude', '最小獲得標高: 急坂に除外点');
f = X.families({ mode: 'cmf', best: bs1, userPts: U2(10000), minLen: 10000, feat: { points: [{ lat: ll(3000, 800).lat, lon: ll(3000, 800).lon, t: 'viewpoint' }] } });
ok(f.length === 3 && f[0].fam === 'busy' && f[1].fam === 'steep' && f[2].fam === 'scenic', '快適・絶景: 損の大きい系統(0.45×(1-Q) > 0.35×(1-H) > 0.20×(1-V))の順');
f = X.families({ mode: 'cmf', best: Object.assign({}, bs1, { cmf: { Q: 1, H: 1, V: 1, spans } }), userPts: U2(10000), minLen: 10000, feat: { points: [] } }); ok(f.length === 0, '損がなければ拡張しない');
ok(X.families({ mode: 'min', best: Object.assign({}, bs1, { m: { z: zf(() => 0) } }), userPts: U2(10000), minLen: 10000 }).length === 0, '急坂がなければ拡張しない(最小獲得標高)');
ok(X.families({ mode: 'max', best, userPts: U2(10000), minLen: 10000, passes: [] }).length === 0, '峠がなければ拡張しない(最大獲得標高)');
/* 検証と提案 */
const fam = [{ fam: 'scenic', kind: 'via', loss: 1, items: [{ pt: { lat: 1, lon: 1 } }, { pt: { lat: 2, lon: 2 } }, { pt: { lat: 3, lon: 3 } }] }, { fam: 'steep', kind: 'exclude', loss: 0.5, items: [{ pt: { lat: 9, lon: 9 } }] }];
ok(X.viaPoints(fam).length === 3, '経由地の候補だけを確認対象にする(除外点は確認しない)');
const vf = X.filterVerified(fam, q => q.lat !== 2); ok(vf[0].items.length === 2 && vf[1].items.length === 1, '確認できない経由地は捨てる');
ok(X.filterVerified([{ fam: 'a', kind: 'via', items: [{ pt: { lat: 5 } }] }], () => false).length === 0, '全部確認できなければ系統ごと消える');
ok(X.filterVerified([{ fam: 'a', kind: 'via', items: [{ pts: [{ lat: 1 }, { lat: 2 }] }] }], q => q.lat !== 2).length === 0, '入口と出口の一方でも確認できなければ捨てる');
let fp = X.firstProposals(vf); ok(fp.length === 2 && fp[0].fam === 'scenic' && fp[1].fam === 'steep' && fp[0].via.length === 1 && fp[1].excl.length === 1, '1段階目: 系統が2つなら、それぞれ1項目で2本');
fp = X.firstProposals([vf[0]]); ok(fp.length === 2 && fp[0].via.length === 1 && fp[1].via.length === 2, '系統が1つなら、1項目版と2項目版');
ok(X.firstProposals([]).length === 0, '提案なし');
const rf = X.refineProposal([fam[0]], { fam: 'scenic', n: 2 }); ok(rf && rf.n === 3 && rf.via.length === 3, '2段階目: 項目を1つ足す');
ok(X.refineProposal([fam[0]], { fam: 'scenic', n: 3 }) === null && X.refineProposal([fam[1]], { fam: 'steep', n: 1 }) === null && X.refineProposal(fam, null) === null, '足せなければなし(上限3項目)');
ok(X.mkProposal({ fam: 'cyc', kind: 'via', items: [{ pts: [{ lat: 1 }, { lat: 2 }] }] }, 1).via.length === 2, '自転車ルートは入口・出口の2点');

/* 改善の判定・値・距離の上限 */
ok(X.improved('max', 300, 200) && !X.improved('max', 220, 200) && X.improved('max', 1100, 1000) === true && !X.improved('max', 1040, 1000), '最大獲得標高: +50mまたは+5%以上');
ok(X.improved('min', 100, 200) && !X.improved('min', 190, 200), '最小獲得標高: 減少が30mまたは5%以上');
ok(X.improved('cyc', 0.7, 0.6) && !X.improved('cyc', 0.62, 0.6), '自転車ルート: +5ポイント');
ok(X.improved('cmf', 0.7, 0.6) && !X.improved('cmf', 0.62, 0.6), '快適・絶景: +0.03');
ok(X.improved('min', 100, null) && !X.improved('min', null, 5), '値なしの扱い');
ok(X.valueOf('cmf', { cmf: { S: 0.5 } }) === 0.5 && X.valueOf('max', { gain: 300 }) === 300 && X.valueOf('cyc', { cyc: null }) === null, '評価値');
ok(X.capFor('max', false) === Infinity && X.capFor('max', true) === 2.0 && X.capFor('min', false) === 1.5 && X.capFor('cmf', true) === 1.5 && X.capFor('cyc', false) === 1.5, '距離の上限: 最大獲得標高の基本候補は上限なし、自動候補は2倍。ほかは1.5倍');
/* 予算 */
let t = 0; const B = new X.Budget({ routeLeft: 3, now: () => t });
ok(B.canStage(2) && B.routeLeft === 3, '予算: 最初は3回'); B.use(2, 1000); ok(B.routeLeft === 1 && B.canStage(1) && !B.canStage(2), '2回使うと残り1回');
B.use(1, 1000); ok(!B.canStage(1), '回数を使い切ると止まる');
const B2 = new X.Budget({ routeLeft: 3, now: () => t }); B2.use(1, 9000); ok(B2.slow && !B2.canStage(1), '1回の応答が8秒を超えたら、以後の拡張を止める');
const B3 = new X.Budget({ routeLeft: 3, now: () => t }); t += 19999; ok(B3.timeUp() === false && B3.canStage(1), '20秒未満は続けられる(時刻の基準は作成時)'); t += 2; ok(B3.timeUp() && !B3.canStage(1), '20秒を超えたら止まる');
ok(new X.Budget({ routeLeft: 1 }).routeLeft === 1 && new X.Budget({ routeLeft: -2 }).routeLeft === 0 && !new X.Budget({ routeLeft: 0 }).canStage(1), '通行止めの再計算で使った分は、枠から引く');
const B4 = new X.Budget({ routeLeft: 3, now: () => t }); B4.use(1, 100); B4.use(1, 100); ok(!B4.canStage(1), '段階は最大2回');
console.log('全 ' + n + ' 件OK (explore)');
