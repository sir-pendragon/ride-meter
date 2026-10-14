const assert = require('assert'); const A = require('../route/aicheck.js'); let n = 0; const ok = (c, m) => { assert(c, m); console.log('ok', m); n++; };
const text = '広河原線 秩父市 全線 通行止め 当面の間\n長久保線 一部区間通行止め 起点より3.5km～終点';
{ const v = A.verifyItems([{ route: '広河原線', quote: '全線 通行止め' }, { route: '作り話線', quote: 'この文章は本文にない' }, { route: 'x', quote: 'ab' }], text); ok(v.kept.length === 1 && v.rejected === 2, '引用が本文にない項目・短すぎる引用は捨てる'); }
ok(A.verifyItems([{ route: '広河原線', quote: '全線　通行止め' }], text).kept.length === 1, '空白(全角含む)の違いは無視して照合');
const rec = (route, status) => ({ route, status });
{ const r = A.compare([rec('広河原線', '通行止め'), rec('長久保線', '一部規制')], [{ route: '林道広河原線', status: '通行止め', quote: 'q' }, { route: '長久保線', status: '規制なし', quote: 'q' }]);
  ok(r.records[0].ai.state === '一致', '同じ判定は一致(林道の接頭辞は無視)'); ok(r.records[1].ai.state === '相違', '私たちは規制、AIは規制なし → 相違'); }
{ const r = A.compare([rec('鈴嵐線', '不明')], [{ route: '鈴嵐線', status: '通行止め', quote: 'q' }]); ok(r.records[0].ai.state === 'AIのみ検出', '私たちが不明、AIが通行止め → AIのみ検出(要確認)'); }
{ const r = A.compare([rec('広河原線', '通行止め')], [{ route: '別の線', status: '通行止め', quote: 'q' }]); ok(r.aiOnly.length === 1 && r.records[0].ai.state === 'AI未検出', '私たちの一覧にない路線はaiOnly、AIが見つけなかった行はAI未検出'); }
{ const r = A.compare([rec('広河原線', '通行止め')], [{ route: '広河原線', status: '不明', quote: 'q' }]); ok(r.records[0].ai.state === 'AIは判断不能', 'AIが判断不能なら、相違とは扱わない'); }
{ const r = A.compare([rec('広河原線', '通行止め')], [{ route: '広河原線', status: '一部規制', quote: 'q' }]); ok(r.records[0].ai.state === '相違', '通行止めと一部規制の食い違いは相違'); }
ok(A.compare([rec('広河原線', '通行止め')], []).records[0].status === '通行止め', 'AIの結果は、私たちの判定(status)を変更しない');
console.log('\n全', n, '件OK');
