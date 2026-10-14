"""実API診断(?rtdiag=1)。模擬サーバーで: 通常画面には出ない / 開始を押すまで通信しない / 保存内容・利用者の地点・APIキーに触れない / 回数・形式・判定 / 429で中止 / 連続実行の抑止。"""
import sys,os,json,re
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from _harness import *
SENT_LAT,SENT_LON='35.70123456','139.50987654'
KEY='AIzaSENTINELSENTINELSENTINEL1234'
INIT="""(()=>{try{if(!localStorage.getItem('rt-state')){localStorage.setItem('rt-state',JSON.stringify({points:[{lat:%s,lon:%s,name:'利用者の地点',k:'s'},{lat:35.71,lon:139.51,name:'g',k:'g'}],closures:[{lat:35.7011,lon:139.5011,name:'利用者の通行止め'}]}));localStorage.setItem('rt-gkey','%s')}}catch(e){}})()"""%(SENT_LAT,SENT_LON,KEY)
def summ(body):
    pts=[(l['lat'],l['lon']) for l in body['locations']]
    return pts
def page(env,url,status429=False,init=True):
    b=PW.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[];reqs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept());pg.on('request',lambda r:reqs.append(r.url))
    env.handler(pg)
    def over(route):
        if route.request.method!='POST' or 'valhalla' not in route.request.url or not route.request.url.endswith('/route'):return route.fallback()
        body=json.loads(route.request.post_data);env.reqs.append(body)
        if status429:return route.fulfill(status=429,json={'error':'rate','status_code':429})
        pts=env.route(body)
        return route.fulfill(json={'trip':{'legs':[{'shape':enc(pts)}],'summary':{'length':plen(pts)/1000,'time':100}}})
    pg.route('**/valhalla1.openstreetmap.de/route',over)
    if init:pg.add_init_script(INIT)
    pg.goto('http://127.0.0.1:%d/%s'%(srv.server_address[1],url));pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    return pg,b,errs,reqs
snap="(()=>{const o=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);o.push([k,localStorage.getItem(k)])}return JSON.stringify(o.sort())})()"
# ---------- 1. 通常画面には出ない ----------
env=Env(route=direct,edges=edgesOf())
pg,b,errs,reqs=page(env,'index.html');pg.wait_for_timeout(800)
ok(pg.query_selector('#rt-diag-panel') is None,'通常画面に診断パネルは出ない')
ok(not any('diag.js' in u for u in reqs),'通常画面では diag.js を読み込まない')
ok(pg.evaluate('typeof window.RtDiag')=='undefined' and pg.evaluate('typeof window.__rtDiagCtx')=='undefined','通常画面に診断の部品は無い')
ok(errs==[],errs);b.close()
# ---------- 2. ?rtdiag=1: パネルは出るが、開始を押すまで通信しない ----------
env=Env(route=direct,edges=edgesOf())
pg,b,errs,reqs=page(env,'index.html?rtdiag=1');pg.wait_for_selector('#rt-diag-panel',timeout=10000);pg.wait_for_timeout(500)
ok(len(env.reqs)==0 and len(env.tr)==0 and len(env.loc)==0 and len(env.ov)==0,'開始を押すまで Valhalla・Overpass に通信しない')
before=pg.evaluate(snap)
ok(SENT_LAT in before,'(試験の前提) 利用者の保存データがある')
pg.evaluate('RtDiag.LIMITS.gapMs=50')
pg.click('#dg-go');pg.wait_for_function('!document.querySelector("#dg-out").hidden',timeout=160000)
rep_txt=pg.input_value('#dg-ta');rep=json.loads(rep_txt)
after=pg.evaluate(snap)
print('calls',rep['totals'],'checks',[(c['id'],c['result']) for c in rep['checks']])
ok(before==after,'診断の前後で、端末の保存内容は同じ')
ok(rep['privacy']['storageUnchanged'] and rep['privacy']['blockedWrites']>0,('保存を止めた記録',rep['privacy']))
ok(SENT_LAT not in rep_txt and SENT_LON not in rep_txt and KEY not in rep_txt and '利用者の' not in rep_txt,'利用者の地点・通行止め・APIキーは結果に出ない')
ok(not re.search(r'-?\d{1,3}\.\d{4,}',rep_txt) and 'AIza' not in rep_txt,'結果に座標らしい数値・キーが無い')
ok(not any(SENT_LAT[:7] in json.dumps(q) for q in env.reqs+env.loc),'利用者の地点を Valhalla に送らない')
ok(not any('valhalla' in u and 'x' for u in []),'')
ok(len(rep['scenarios'])==5 and [s['id'] for s in rep['scenarios']]==['min','max','cyc','cmf','cmf-via'],'4つの条件+経由地つきを順番に実行')
cnt=rep['totals']['perKind']
ok(cnt.get('valhalla/route')==len(env.reqs) and cnt.get('valhalla/trace_attributes')==len(env.tr) and cnt.get('valhalla/locate',0)==len(env.loc),('Valhallaの回数が、サーバー側の受信数と一致',cnt,len(env.reqs),len(env.tr),len(env.loc)))
ok(rep['totals']['valhalla']==len(env.reqs)+len(env.tr)+len(env.loc) and rep['totals']['valhalla']<=rep['limits']['valhallaCap'],'合計回数が上限以内')
C={c['id']:c for c in rep['checks']}
ok(C['route.format']['result']=='OK' and C['trace.format']['result'] in('OK','一部未確認') and C['locate.format']['result']=='OK',('形式の判定',C['route.format'],C['trace.format'],C['locate.format']))
ok(all(C['mode.'+m]['result']=='OK' for m in('min','max','cyc','cmf','cmf-via')),[(k,v['result'],v['detail']) for k,v in C.items() if k.startswith('mode')])
ok(C['via.attrs']['result']=='OK' and C['storage']['result']=='OK' and C['privacy.scan']['result']=='OK',[C['via.attrs'],C['storage']])
ok(rep['xClientId']=='allowed' and C['cors.xclientid']['result']=='OK','X-Client-Id付きの確認通信が通る(模擬)')
ok(C['struct.fix']['result']=='未確認','橋・トンネルが出ない模擬では、補正は「未確認」のまま(成功にしない)')
ok(rep['schemas'].get('/route') and rep['schemas'].get('/trace_attributes') and not json.dumps(rep['schemas']).count('"abc"'),'応答の形を記録')
ok(rep['aborted'] is None and all(('ms' in c) for c in rep['calls'] if c['svc']=='valhalla'),'中止なし・各通信の時間を記録')
ok(rep['route']['customCoords'] is False and 'coords' not in json.dumps(rep['route']),'座標は記録しない')
# 保存を止めている間は、通常の操作でも保存されない(診断の地点で上書きされない)
pg.evaluate("localStorage.setItem('rt-state','{}')");ok(pg.evaluate(snap)==before,'診断中の保存は無視される')
# 連続実行の抑止
pg.click('#dg-go');pg.wait_for_timeout(300);ok('連続して実行しないでください' in pg.inner_text('#dg-log'),'直後の再実行は受け付けない')
nreq=len(env.reqs);pg.wait_for_timeout(500);ok(len(env.reqs)==nreq,'再実行しても通信は増えない')
ok(errs==[],errs)
# 終了: 診断なしの画面に戻り、保存内容は変わっていない
pg.click('#dg-end');pg.wait_for_function('!location.search',timeout=10000);pg.wait_for_selector('#obj',timeout=10000);pg.wait_for_timeout(500)
ok(pg.query_selector('#rt-diag-panel') is None,'終了後は診断パネルが無い')
ok(json.loads(pg.evaluate("localStorage.getItem('rt-state')"))['points'][0]['name']=='利用者の地点','終了後も利用者の保存データは元のまま')
b.close()
# ---------- 3. 429なら中止(以降は通信しない) ----------
env=Env(route=direct,edges=edgesOf())
pg,b,errs,reqs=page(env,'index.html?rtdiag=1',status429=True);pg.wait_for_selector('#rt-diag-panel',timeout=10000)
pg.evaluate('RtDiag.LIMITS.gapMs=50');pg.click('#dg-go');pg.wait_for_function('!document.querySelector("#dg-out").hidden',timeout=120000)
rep=json.loads(pg.input_value('#dg-ta'));C={c['id']:c for c in rep['checks']}
print('429:',rep['aborted'],rep['totals'])
ok(rep['aborted'] and '429' in rep['aborted'],'429を受けたら中止を記録')
ok(rep['totals']['valhalla']<=6,('429のあとは、Valhallaへ通信しない(回数)',rep['totals']['valhalla']))
ok(C['limits']['result']=='NG' and C['route.format']['result']=='NG','429は「成功」にしない')
ok([s for s in rep['scenarios'] if s.get('skipped')],'中止後の場面は実行しない')
b.close()
# ---------- 4. 呼び出し回数の上限 ----------
env=Env(route=direct,edges=edgesOf())
pg,b,errs,reqs=page(env,'index.html?rtdiag=1');pg.wait_for_selector('#rt-diag-panel',timeout=10000)
pg.evaluate('RtDiag.LIMITS.gapMs=50;RtDiag.LIMITS.valhallaCap=6');pg.click('#dg-go');pg.wait_for_function('!document.querySelector("#dg-out").hidden',timeout=120000)
rep=json.loads(pg.input_value('#dg-ta'))
ok(rep['totals']['valhalla']==6 and len(env.reqs)+len(env.tr)+len(env.loc)==6 and '上限' in (rep['aborted'] or ''),('上限に達したら以降は通信しない',rep['totals'],rep['aborted']))
b.close()
done('diag-flow')
