# python3 tests/pass_db_test.py  (峠の座標データベースの変換: 種類・標高・升目の索引)
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
from build_pass_db import build, ele_of, kind
n = 0
def ok(c, m):
    assert c, m; print('ok', m); global n; n += 1
els = [
  {'type':'node','lat':35.951,'lon':139.101,'tags':{'mountain_pass':'yes','natural':'saddle','name':'正丸峠','ele':'620'}},
  {'type':'node','lat':35.952,'lon':139.102,'tags':{'natural':'saddle','ele':'1,234.5'}},
  {'type':'node','lat':36.051,'lon':139.201,'tags':{'natural':'peak','name':'山','ele':'800 m'}},
  {'type':'node','lat':36.052,'lon':139.202,'tags':{'natural':'peak','ele':'不明'}},
  {'type':'node','lat':36.053,'lon':139.203,'tags':{'tourism':'viewpoint'}},
  {'type':'way','id':1,'tags':{'natural':'saddle'}},
]
d = build(els, at='2026-10-15', bbox=[35.9, 139.0, 36.1, 139.3])
ok(d['n'] == 4 and d['kinds'] == ['pass', 'peak', 'saddle'], '峠・鞍部・山頂だけ(展望地・wayは除く)')
d2 = build(els, at='2026-10-15', bbox=[35.9, 139.0, 36.1, 139.3], kinds=('pass', 'saddle'))
ok(d2['n'] == 2 and d2['kinds'] == ['pass', 'saddle'], '種類を絞ると山頂は入らず、kinds も問い合わせた種類だけ')
ok([p[3] for p in d['pts'] if p[4] == '正丸峠'] == ['pass'], 'pass と saddle が両方付くときは pass')
ok(ele_of({'ele': '1,234.5'}) == 1234.5 and ele_of({'ele': '800 m'}) == 800 and ele_of({'ele': '不明'}) is None and kind({}) is None, '標高の数値化(カンマ・単位・不明)')
ok(d['idx']['359,1391'] == [0, 2] and d['idx']['360,1392'] == [2, 2], '0.1°の升目ごとの位置と個数')
ok(d['bbox'] == [35.9, 139.0, 36.1, 139.3] and d['at'] == '2026-10-15', '範囲と日付')
ok(all(d['pts'][i][0] // 0.1 <= d['pts'][i + 1][0] // 0.1 + 1e-9 for i in range(len(d['pts']) - 1)), '升目の順に並ぶ')
print('全', n, '件OK (pass_db)')
