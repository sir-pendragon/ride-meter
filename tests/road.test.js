// 道路(国道・県道)の規制: 青森(JSON5)・福島(JSON)・群馬(HTMLはe2eで)の解釈と、公式の代表地点からの位置付け
const assert = require('assert'); const fs = require('fs');
const R = require('../route/parse-road.js'); const L = require('../route/locate.js');
let n = 0; const ok = (c, m) => { assert(c, m); console.log('ok', m); n++; };
const T = new Date(Date.UTC(2026, 9, 14));
// JSON5(評価はしない)
ok(JSON.stringify(R.parseJson5("[{a:1,b:'x\\ny',c:[1,2.5],d:\"q\"},]")) === JSON.stringify([{ a: 1, b: 'x\ny', c: [1, 2.5], d: 'q' }]), 'JSON5を読める(キー・単引用符・末尾カンマ・改行)');
assert.throws(() => R.parseJson5("[{a:alert(1)}]"), /JSON5/); ok(true, '関数呼び出しなどは読まずに拒否する');
// 路線名
ok(R.routeOf('（主）青森五所川原線') === '青森五所川原線' && R.routeOf('（国）国道279号（下北半島縦貫道路）') === '国道279号' && R.routeOf('中之条土木 （国）１４５号') === '国道145号' && R.routeOf('中之条土木 上信自動車道') === '上信自動車道', '路線名の整形');
// 青森
const ao = R.parseAomori(fs.readFileSync(__dirname + '/data/aomori-traffic_regulation.json5', 'utf8'), 'u', '2026-10-14T00:00:00Z', { today: T, lastModified: 'Wed, 14 Oct 2026 09:20:52 GMT' });
const by = (r) => ao.filter((x) => x.route === r);
ok(!ao.some((x) => x.route === '将来の路線'), '開始前の規制は除く');
ok(by('夏泊公園線')[0].status === '通行止め' && by('夏泊公園線')[0].officialPoint.lenM === 300, '全面通行止め+延長300m+代表地点');
ok(by('青森五所川原線')[0].status === '一部規制' && /大型車/.test(by('青森五所川原線')[0].note), '大型車通行止めは一部規制(自転車の扱いは記載なし)');
ok(by('西目屋二ツ井線')[0].period.endsWith('R8.秋頃') && by('西目屋二ツ井線')[0].officialPoint.lenM === 14800, '期間が読めない(R8.秋頃)ものは除かず、そのまま残す');
ok(by('五所川原車力線')[0].status === '一部規制', '夜間規制は一部規制');
ok(by('国道279号')[0].status === '一部規制' && ao.every((x) => x.bicycle === null && x.municipality === null && x.layer === 'road' && x.officialUpdated === '2026-10-14'), '自転車は記載なし・市町村は決めない・公式の更新日');
// 福島
const fl = JSON.parse(fs.readFileSync(__dirname + '/data/fukushima-lists.json', 'utf8'));
const fk = R.parseFukushima(Object.entries(fl).map(([kind, items]) => ({ kind, items })), 'u', '2026-10-14T00:00:00Z', { today: T, updated: '2026-10-14' });
const f = (r) => fk.filter((x) => x.route === r)[0];
ok(!fk.some((x) => x.route === '国道252号'), '冬期閉鎖(11/4開始)はまだ始まっていないので除く');
ok(f('浪江国見線').status === '一部規制' && f('原町二本松線').status === '通行止め' && f('国道118号').status === '通行止め', '大型通行止=一部規制 / 全面通行止=通行止め / 国道名の整形');
ok(f('棚倉矢吹線').bicycle === true && f('浪江国見線').bicycle === null, '自転車の通行可が原文にあるときだけ true');
ok(f('原町二本松線').section === '南相馬市原町区高倉字国見～相馬郡飯舘村大字蕨平字木戸' && f('棚倉矢吹線').section === '西白河郡矢吹町新町', '区間は住所のまま');
// 位置付け: 代表地点+延長からの切り出し
const pts = []; for (let i = 0; i <= 100; i++) pts.push([40.0 + i * 0.0005, 140.0]); // 北へ約5.5kmの直線
const els = [{ id: 1, tags: { name: '夏泊公園線', highway: 'primary' }, geometry: pts.map((p) => ({ lat: p[0], lon: p[1] })) }];
const rec = (len, lat, lon) => ({ route: '夏泊公園線', municipality: null, section: '', status: '通行止め', scope: 'partial', layer: 'road', officialPoint: { lat, lon, lenM: len } });
let r1 = L.locate([rec(300, 40.025, 140.0001)], els)[0];
ok(r1.selected && r1.position.level === '要確認' && r1.position.confidence === '低' && r1.selected.d1 - r1.selected.d0 > 300 && r1.selected.d1 - r1.selected.d0 < 450, '短い区間は、代表地点の前後を「要確認(確度低)」で切り出す');
ok(L.locate([rec(14800, 40.025, 140.0)], els)[0].position.level === '不明', '3kmを超える区間は、範囲を決められず「不明」');
ok(L.locate([rec(300, 40.025, 140.02)], els)[0].position.level === '不明', '代表地点が道から300mを超えて離れていれば「不明」');
ok(/夏泊公園線/.test(L.buildRoadQuery([rec(1, 0, 0)], [39, 139, 41, 141])) && !/\["name"~"林道"\]/.test(L.buildRoadQuery([rec(1, 0, 0)], [39, 139, 41, 141])), '道路用の検索は「林道」を条件にしない');
console.log('\n全 ' + n + ' 件OK');
