"""実機の診断で見つかった2点の再発防止(模擬サーバー): ①edge_walkで道路属性が取れなくても、walk_or_snapで取得できる ②Overpassが応答しなくても、時間で打ち切って検索を続ける"""
import sys,os,json,time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from _harness import *
def go(env,obj,trace_hook=None,init=None,hang_overpass=False):
    b=PW.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
    env.handler(pg)
    if trace_hook:pg.route('**/valhalla1.openstreetmap.de/trace_attributes',trace_hook)
    if hang_overpass:pg.route('**/*overpass*/**',lambda r:None)   # 応答しない
    if init:pg.add_init_script(init)
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    pg.select_option('#obj',obj)
    pg.evaluate("__rt.st.points=[{lat:%f,lon:%f,name:'S',k:'s'},{lat:%f,lon:%f,name:'G',k:'g'}]"%(S+G))
    return pg,b,errs
# ① edge_walk なら 400/443(実APIで、自動経由地つきの経路で起きた)。walk_or_snap なら通る
seen=[]
def hook(route):
    body=json.loads(route.request.post_data);seen.append(body.get('shape_match'))
    if body.get('shape_match')=='edge_walk':return route.fulfill(status=400,json={'error_code':443,'status_code':400,'error':'Exact route match algorithm failed'})
    return route.fallback()
env=Env(route=direct,edges=edgesOf())
pg,b,errs=go(env,'cmf',hook)
pg.click('#go');pg.wait_for_selector('#cards .card',timeout=40000);pg.wait_for_timeout(600)
ok(seen and all(m=='walk_or_snap' for m in seen),('道路属性の問い合わせは walk_or_snap',set(seen)))
r=pg.evaluate("({n:__rt.st.cands.length,edges:__rt.st.cands.filter(c=>c.edges&&c.edges.length).length,Q:__rt.st.cands[0].cmf&&__rt.st.cands[0].cmf.Q})")
ok(r['n']>0 and r['edges']==r['n'] and r['Q'] is not None,('全候補で道路属性を取得し、静かさを評価できる',r))
ok(errs==[],errs);b.close()
# ② Overpassが応答しない: 接続先ごとに打ち切り、景観なしで検索を完了(診断では103秒後に504、アプリは待ち続けた)
env=Env(route=direct,edges=edgesOf(),feat=[])
pg,b,errs=go(env,'cmf',None,'window.__rtOvpMs=700;',hang_overpass=True)
t=time.time();pg.click('#go');pg.wait_for_selector('#cards .card',timeout=40000);pg.wait_for_timeout(500);dt=time.time()-t
txt=pg.evaluate("(__rt.st.cmfErr||[]).join('|')")
print('Overpass無応答: %.1f秒'%dt,txt)
ok(dt<20,('Overpassが応答しなくても、時間で打ち切って完了',dt))
ok('時間切れ' in txt and '景観は評価せず' in txt,('景観を評価しない旨を表示',txt))
ok(pg.evaluate("__rt.st.cands.length>0 && !!__rt.st.sel"),'景観なしでも候補を選べる')
ok(errs==[],errs);pg.unroute_all(behavior='ignoreErrors');b.close()
# ③ 景観の線(川・湖・海岸): geom(範囲) は範囲の外の点を null で返す。落ちずに、線を分けて評価する(実機で、これが原因で景観が毎回「評価なし」だった)
VP=[{'type':'node','lat':35.9036,'lon':139.1000,'tags':{'tourism':'viewpoint'}}]
RIV={'type':'way','tags':{'waterway':'river'},'geometry':[None,{'lat':35.9004,'lon':139.0900},{'lat':35.9004,'lon':139.1000},None,{'lat':35.9004,'lon':139.1100},{'lat':35.9004,'lon':139.1110}]}
env=Env(route=direct,edges=edgesOf(),feat=VP+[RIV])
pg,b,errs=go(env,'cmf')
pg.click('#go');pg.wait_for_selector('#cards .card',timeout=40000);pg.wait_for_timeout(600)
r=pg.evaluate("({err:(__rt.st.cmfErr||[]).join('|'),lines:__rt.st.feat&&__rt.st.feat.lines&&__rt.st.feat.lines.length,V:__rt.st.cands[0].cmf&&__rt.st.cands[0].cmf.V})")
ok(r['err']=='' and r['lines']==2 and r['V'] is not None,('null を含む線でも景観を評価(線は null で2つに分かれる)',r))
ok(len(env.ov)==1,('Overpassは1回(2番目の接続先へ進まない)',len(env.ov)));ok(errs==[],errs);b.close()
# ④ 200でも実行時エラーの注記つきなら、失敗として扱い、空の結果を保存しない
env=Env(route=direct,edges=edgesOf(),feat=VP)
pg,b,errs=go(env,'cmf')
pg.route('**/*overpass*/**',lambda r:r.fulfill(json={'elements':[],'remark':'runtime error: Query timed out in "query" at line 1.'},headers={'access-control-allow-origin':'*'}))
pg.click('#go');pg.wait_for_selector('#cards .card',timeout=40000);pg.wait_for_timeout(600)
ok('景観のデータを取得できませんでした' in pg.evaluate("(__rt.st.cmfErr||[]).join('|')"),'実行時エラーの注記つきは失敗として扱い、景観は評価しない旨を表示')
ok(pg.evaluate("caches.open('rt-scn').then(c=>c.keys()).then(k=>k.length)")==0,'失敗した(空の)結果はキャッシュしない')
ok(errs==[],errs);b.close()
# ⑤ 最大獲得標高: Overpass(峠)が失敗しても、基本ルートを返し、追加探索をしていないことを明示。本家が失敗したら、予備(private.coffee・maps.mail.ru)を順に試す(計3回)。kumiには行かない
env=Env(route=direct,edges=edgesOf(),ov_fail=True)
pg,b,errs=go(env,'max')
reqs=[];pg.on('request',lambda r:reqs.append(r.url))
pg.click('#go');pg.wait_for_selector('#cards .card',timeout=40000);pg.wait_for_timeout(600)
txt=pg.inner_text('#cards')
ok(pg.evaluate("__rt.st.cands.length>=1 && !!__rt.st.sel"),'峠データが取れなくても、基本ルートを返す')
ok('追加探索は行っていません' in txt and '峠のデータを取得できませんでした' in txt,('追加探索が未実施であることと理由を表示',txt[:300]))
ok(len(env.ov)==3 and not any('kumi' in u for u in reqs),('Overpassは本家+予備2か所の計3回',len(env.ov)))
ok('地図データの取得:' in txt and 'overpass.private.coffee' in txt and 'maps.mail.ru' in txt,('取得先ごとの成否を表示',txt[-400:]))
ok(errs==[],errs);b.close()
done('attrs-fallback')
