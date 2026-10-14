const assert = require('assert');
const R = require('../route/muni-registry.js');
const fs = require('fs');
let n = 0; const ok = (m) => { n++; };

// 名前の正規化(政令市の区は市に寄せる)
assert.strictEqual(R.normName('相模原市　緑区'), '相模原市'); ok();
assert.strictEqual(R.normName('さいたま市 西区'), 'さいたま市'); ok();
assert.strictEqual(R.normName('秩父市'), '秩父市'); ok();
assert.strictEqual(R.keyOf('神奈川県', '横浜市　青葉区'), '神奈川県|横浜市'); ok();

// 台帳の整合(全ファイル)
const exp = { ibaraki: 44, tochigi: 25, gunma: 35, saitama: 63, chiba: 54, tokyo: 62, kanagawa: 33, fukushima: 59 };
const ST = new Set(['found', 'found_empty', 'index_only', 'unverified', 'not_found']);
const by = {};
for (const f of Object.keys(exp)) {
  const d = JSON.parse(fs.readFileSync(`data/muni-inventory/${f}.json`, 'utf8'));
  assert.strictEqual(d.length, exp[f], f + ' の件数'); ok();
  const names = new Set();
  for (const x of d) {
    assert.ok(ST.has(x.status), `${f}/${x.name}: status ${x.status}`);
    assert.ok(!names.has(x.name), `${f}: 名前の重複 ${x.name}`); names.add(x.name);
    assert.ok(x.pref && R.FILES[x.pref] === f, `${f}/${x.name}: pref`);
    assert.ok(!('code' in x), `${f}/${x.name}: 未照合の code が残っている`);
    if (['found', 'found_empty', 'index_only'].includes(x.status)) assert.ok(/^https?:\/\//.test(x.url || ''), `${f}/${x.name}: 確認済みなのにURLなし`);
    if (x.url) assert.ok(/^https?:\/\/[^/]*\.(lg\.jp|jp|tokyo|com)\//.test(x.url) || /^https?:\/\/town\.|^https?:\/\/vill\./.test(x.url), `${f}/${x.name}: URL形式 ${x.url}`);
  }
  by[x0(d)] = d; function x0(d) { return d[0].pref; }
}
ok();
const reg = R.build(by);
assert.strictEqual(reg.size, 375); ok();

// ルート突き合わせ
const r = R.forRoute(reg, ['神奈川県|相模原市', '神奈川県|相模原市', '神奈川県|山北町', '山梨県|甲府市', '東京都|あきる野市', '神奈川県|存在しない町']);
assert.ok(r.listed.some((x) => x.name === '相模原市')); ok();
assert.strictEqual(r.listed.filter((x) => x.name === '相模原市').length, 1, '重複は1回'); ok();
assert.deepStrictEqual(r.outside.map((x) => x.name), ['甲府市']); ok();
assert.ok(r.unconfirmed.some((x) => x.name === '存在しない町' && x.status === '台帳に無し')); ok();
// 政令市の区(国土地理院の表の表記)でも市として引ける
const r2 = R.forRoute(reg, ['神奈川県|相模原市　緑区']);
assert.strictEqual(r2.listed[0].name, '相模原市'); ok();
// 未確認は「確認済み」に入らない
const un = [...reg.values()].find((x) => x.status === 'unverified');
const r3 = R.forRoute(reg, [un.pref + '|' + un.name]);
assert.strictEqual(r3.listed.length, 0); assert.strictEqual(r3.unconfirmed.length, 1); ok();

// 取得先の絞り込み
const src = { id: 'matsumoto', muni: '長野県|松本市' };
assert.ok(R.wantsMuni(src, new Set(['長野県|松本市']))); ok();
assert.ok(!R.wantsMuni(src, new Set(['長野県|伊那市']))); ok();
assert.ok(R.wantsMuni(src, null), '判定できないときは絞らない'); ok();
assert.ok(R.wantsMuni({ id: 'x' }, new Set(['長野県|伊那市']))); ok();

(async () => {
  const L = await R.load(['神奈川県', '山梨県'], async (u) => { if (u.includes('kanagawa')) return JSON.parse(fs.readFileSync('data/' + u.replace('../data/', ''), 'utf8')); throw new Error('x'); });
  assert.strictEqual(L.reg.size, 33); assert.deepStrictEqual(L.errs, []); ok(); // 山梨は台帳なし(FILESに無い)=エラー扱いではなく対象外
  const L2 = await R.load(['神奈川県'], async () => { throw new Error('net'); });
  assert.deepStrictEqual(L2.errs, ['神奈川県']); ok();
  console.log(`全 ${n} 件OK (muni-registry)`);
})();
