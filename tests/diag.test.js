// 実API診断(route/diag.js)の純粋な部分: 座標・キーの除去、応答の形、属性の集計、判定(確認できないものは「未確認」)、漏えい点検
const D = require('../route/diag.js');
let n = 0;
const ok = (c, m) => { if (!c) { console.error('NG:', m); process.exit(1); } n++; };
// scrub: 座標らしい数・APIキー・URLの中身を消す
ok(!/35\.12345/.test(D.scrub('near 35.123456, 139.654321 failed')), '座標を消す');
ok(!/AIza/.test(D.scrub('key=AIzaSyA1234567890123456789012345 bad')), 'APIキーを消す');
ok(D.scrub('see https://x.example/a?key=zz&lat=1') === 'see https://x.example', 'URLは出所だけ');
ok(D.scrub('a'.repeat(500)).length === 200, '長さを制限');
// schemaOf: 値を持たない
const sc = D.schemaOf({ trip: { legs: [{ shape: 'abc', len: 1.5 }], summary: { length: 3 } }, x: null });
ok(sc.trip.legs[0].shape === 'string' && sc.trip.summary.length === 'number' && sc.x === 'null', '形だけ');
ok(!/abc/.test(JSON.stringify(sc)), '値は入らない');
// 属性の集計
const A = D.newAgg();
D.addEdges(A, [{ length: 1.2, road_class: 'tertiary', use: 'road', surface: 'paved', lane_count: 2, bridge: true, travel_mode: 'bicycle' }, { length: 0.3, road_class: 'path', use: 'cycleway', surface: 'compacted' }]);
ok(A.edges === 2 && Math.abs(A.km - 1.5) < 1e-9 && A.bridge === 1 && A.tunnel === 0, '辺・距離・橋');
ok(A.present.lane_count === 1 && A.present.speed_limit === 0 && A.values.surface.paved === 1, '出現数・値の種類');
ok(D.edgeFit([{ length: 1 }, { length: 1 }], 2000) === 1 && D.edgeFit([], 1000) === null && D.edgeFit([{ length: 1 }], 0) === null, '辺と長さの整合');
// 判定
function rep(over) {
  const r = { calls: [], schemas: {}, traceAttrs: D.newAgg(), scenarios: [], totals: { ms: 10 }, privacy: { storageUnchanged: true, blockedWrites: 2 } };
  return Object.assign(r, over || {});
}
const get = (C, id) => C.find((c) => c.id === id);
let C = D.buildChecks(rep());
ok(get(C, 'route.format').result === '未確認' && get(C, 'locate.format').result === '未確認' && get(C, 'trace.format').result === '未確認', '通信がなければ未確認(成功にしない)');
ok(get(C, 'explore.auto').result === '未確認' && get(C, 'struct.fix').result === '未確認' && get(C, 'overpass').result === '未確認', '追加候補・補正・Overpassも、確認できなければ未確認');
ok(get(C, 'via.attrs').result === '未確認' && get(C, 'attrs.fit').result === '未確認', '経由地つき・属性の整合も未確認');
// 形式の判定
const A2 = D.newAgg(); D.addEdges(A2, [{ length: 1, road_class: 'a', use: 'road', surface: 'paved' }]);
C = D.buildChecks(rep({
  calls: [{ svc: 'valhalla', path: '/route', status: 200 }, { svc: 'valhalla', path: '/locate', status: 200 }, { svc: 'valhalla', path: '/trace_attributes', status: 200 }],
  schemas: { '/route': { trip: { legs: [{ shape: 'string' }], summary: { length: 'number' } } }, '/locate': [{ edges: [{ edge: { access: { bicycle: 'boolean' } } }] }], '/trace_attributes': { edges: [{}] } }, traceAttrs: A2
}));
ok(get(C, 'route.format').result === 'OK' && get(C, 'locate.format').result === 'OK', '形式OK');
ok(get(C, 'trace.format').result === '一部未確認' && /bridge/.test(get(C, 'trace.format').detail), '出現しない任意の属性は「一部未確認」(異常とは断定しない)');
const A3 = D.newAgg(); D.addEdges(A3, [{ length: 1, use: 'road' }]);
C = D.buildChecks(rep({ calls: [{ svc: 'valhalla', path: '/trace_attributes', status: 200 }], traceAttrs: A3 }));
ok(get(C, 'trace.format').result === 'NG' && /road_class/.test(get(C, 'trace.format').detail), '必須の属性が出なければNG');
C = D.buildChecks(rep({ calls: [{ svc: 'valhalla', path: '/route', status: 500 }], schemas: {} }));
ok(get(C, 'route.format').result === 'NG', '/route が200でなければNG');
// 条件・経由地・橋
const best = (fit) => ({ km: 10, gain: 100, edgeFit: fit, legs: 'single' });
const sc1 = (id, extra) => Object.assign({ kind: 'mode', id, cands: 2, auto: 0, sel: 0, ms: 100, valhalla: 5, best: best(1), fixedCands: 0 }, extra || {});
C = D.buildChecks(rep({ scenarios: [sc1('min'), sc1('max', { error: 'x', cands: 0, sel: -1 }), sc1('cmf-via', { auto: 1, fixedCands: 1 }), sc1('cyc', { skipped: '中止', cands: 0 })], traceAttrs: Object.assign(D.newAgg(), { bridge: 2 }) }));
ok(get(C, 'mode.min').result === 'OK' && get(C, 'mode.max').result === 'NG' && get(C, 'mode.cyc').result === '未確認', '条件ごとの判定(実行しなかったものは未確認)');
ok(get(C, 'via.attrs').result === 'OK' && get(C, 'explore.auto').result === 'OK' && get(C, 'struct.fix').result === 'OK', '経由地・追加候補・補正');
C = D.buildChecks(rep({ scenarios: [sc1('min', { best: best(1.6) })] }));
ok(get(C, 'attrs.fit').result === 'NG', '辺の長さがルートと25%超ずれたらNG');
C = D.buildChecks(rep({ scenarios: [sc1('min')], traceAttrs: Object.assign(D.newAgg(), { bridge: 1 }) }));
ok(get(C, 'struct.fix').result === '未確認' && /原因は未確認/.test(get(C, 'struct.fix').detail), '橋があっても補正が入らなければ、成功にしない');
// 負荷・保存
C = D.buildChecks(rep({ calls: [{ svc: 'valhalla', path: '/route', status: 429 }] }));
ok(get(C, 'limits').result === 'NG', '429があればNG');
C = D.buildChecks(rep({ privacy: { storageUnchanged: false, blockedWrites: 0 } }));
ok(get(C, 'storage').result === 'NG', '保存内容が変わればNG');
// 漏えい点検
ok(D.leaks('{"a":35.123456}') && D.leaks('AIzaSyA1234567890123456789012345') && !D.leaks('{"km":12.3,"q":0.512}'), '座標・キーの点検');
// 通信の種別
ok(D.classify('https://valhalla1.openstreetmap.de/route?x=1', 'https://valhalla1.openstreetmap.de').path === '/route', 'Valhalla');
ok(D.classify('https://overpass-api.de/api/interpreter').svc === 'overpass' && D.classify('https://cyberjapan.jp/xyz/dem/13/1/2.txt').svc === 'dem' && D.classify('https://maps.googleapis.com/x?key=AIza').host === 'maps.googleapis.com', '種別');
console.log('全 ' + n + ' 件OK');
