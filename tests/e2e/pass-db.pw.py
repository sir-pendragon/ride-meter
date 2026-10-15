"""峠の座標データベース(同梱)の受け口: ①範囲内なら Overpass に峠を聞かない(最大獲得標高・国道の迂回) ②範囲外・なしなら従来どおり Overpass ③同梱の出どころを結果に表示"""
import sys,os,json,math,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from _harness import *
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','tools'))
from build_pass_db import build
import urllib.parse
passQ=lambda q:'saddle' in urllib.parse.unquote_plus(q)   # 峠の問い合わせ(景観の問い合わせにも mountain_pass は入るが saddle は入らない)
PX=(35.9150,139.1000)
def hill(la,lo):
    d=math.hypot((la-PX[0])*111195,(lo-PX[1])*90110);return 200.0+250.0*max(0,1-d/2600)
viaRoute=lambda body:[(l['lat'],l['lon']) for l in body['locations']]
edgesQuiet=lambda pts:[{'length':plen(pts)/1000,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth','lane_count':1,'speed_limit':30}]
edgesTrunk=lambda pts:[{'length':plen(pts)/1000,'road_class':'trunk','use':'road','travel_mode':'bicycle','surface':'paved_smooth','lane_count':2,'speed_limit':50}]
EL=[{'type':'node','lat':PX[0],'lon':PX[1],'tags':{'natural':'peak','ele':'450','name':'テスト山'}},{'type':'node','lat':35.9120,'lon':139.0950,'tags':{'mountain_pass':'yes','ele':'380','name':'テスト峠'}}]
DB=build(EL,at='2026-10-15',bbox=[35.5,138.5,36.5,139.9])
DB_SMALL=build(EL,at='2026-10-15',bbox=[35.905,139.09,35.92,139.11])   # 検索範囲より狭い
def withDB(db):
    def f(env,obj,**kw):
        o=env.handler
        def h2(pg):
            o(pg)
            if db is not None:pg.route('**/data/osm-pass/jp.json',lambda r:r.fulfill(json=db))
        env.handler=h2;return run(env,obj,**kw)
    return f
# ① 最大獲得標高: 同梱で峠を引き、Overpass(峠)に聞かない。追加探索は行われる
env=Env(route=viaRoute,edges=edgesQuiet,passes=[],elev=hill)
r,pg,b=withDB(DB)(env,'max')
ok(not any(passQ(q) for q in env.ov),('同梱の範囲内なら Overpass に峠を聞かない',len(env.ov)))
ok(r['xlog']['routes']>=1 and any(c['auto'] for c in r['cands']),('同梱の峠で追加探索が行われる',r['xlog']))
txt=pg.inner_text('#cards');ok('同梱の座標データベース(OSM 2026-10-15)' in txt,('出どころを表示',txt[-300:]))
ok(r['errs']==[],r['errs']);close(b)
# ② 範囲が狭くて収まらない → Overpass に聞く(模擬は空 → 追加探索なし)
env=Env(route=viaRoute,edges=edgesQuiet,passes=[],elev=hill)
r,pg,b=withDB(DB_SMALL)(env,'max')
ok(any(passQ(q) for q in env.ov),'同梱の範囲に収まらなければ Overpass に聞く')
txt=pg.inner_text('#cards');ok('同梱の座標データベース' not in txt,'Overpass を使ったときは同梱の表示を出さない');close(b)
# ③ 同梱なし(404) → 従来どおり Overpass
env=Env(route=viaRoute,edges=edgesQuiet,passes=[],elev=hill)
r,pg,b=withDB(None)(env,'max')
ok(any(passQ(q) for q in env.ov),'同梱がなければ Overpass に聞く');close(b)
# ④ 快適・絶景で国道が長い: 同梱の峠(鞍部・峠のみ。山頂は使わない)で迂回を試し、Overpass に峠を聞かない
env=Env(route=viaRoute,edges=edgesTrunk,passes=[],feat=[])
r,pg,b=withDB(DB)(env,'cmf')
props=[p for s in r['xlog']['stages'] for p in s['props']]
ok(any(p.startswith('quiet') for p in props),('国道が長いとき、同梱の峠で迂回(quiet)を試す',r['xlog']))
ok(not any(passQ(q) for q in env.ov),'Overpass に峠を聞かない(快適・絶景)')
txt=pg.inner_text('#cards');ok('同梱の座標データベース' in txt,'出どころを表示(快適・絶景)');ok(r['errs']==[],r['errs']);close(b)
done('pass-db')
