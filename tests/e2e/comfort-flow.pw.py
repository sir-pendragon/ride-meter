"""快適・絶景モードと共通探索(模擬サーバー): 採点・API回数・補正・除外・距離の上限・自動経由地の確認。"""
import urllib.parse,json,time,threading,http.server,socketserver,os,functools,math
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
def enc(pts):
    out='';pla=plo=0
    for la,lo in pts:
        a=round(la*1e6);b=round(lo*1e6)
        for d in (a-pla,b-plo):
            d=~(d<<1) if d<0 else d<<1
            while d>=0x20:
                out+=chr((0x20|(d&0x1f))+63);d>>=5
            out+=chr(d+63)
        pla,plo=a,b
    return out
def dec(s):
    i=0;la=lo=0;o=[]
    while i<len(s):
        for k in (0,1):
            sh=r=0
            while True:
                b=ord(s[i])-63;i+=1;r|=(b&31)<<sh;sh+=5
                if b<32:break
            v=~(r>>1) if r&1 else r>>1
            if k==0:la+=v
            else:lo+=v
        o.append((la/1e6,lo/1e6))
    return o
def hav(a,b):
    R=6371008.8;p=math.pi/180;dl=(b[0]-a[0])*p;dg=(b[1]-a[1])*p
    return 2*R*math.asin(math.sqrt(math.sin(dl/2)**2+math.cos(a[0]*p)*math.cos(b[0]*p)*math.sin(dg/2)**2))
def plen(pts):return sum(hav(pts[i-1],pts[i]) for i in range(1,len(pts)))
S=(35.9000,139.0800);G=(35.9000,139.1200)
n=0
def ok(c,m):
    global n;assert c,m;n+=1
def tile(x,y,elev):
    N=2**13;rows=[]
    for py in range(256):
        fy=y+(py+.5)/256;la=math.degrees(math.atan(math.sinh(math.pi*(1-2*fy/N))))
        rows.append(','.join('%.1f'%elev(la,(x+(px+.5)/256)/N*360-180) for px in range(256)))
    return '\n'.join(rows)
FLATZ=lambda la,lo:200.0

class Env:
    """1つの場面。route(body)→点列 / alt(body)→代替の点列 / edges(pts)→trace_attributesの辺 / feat→Overpassの要素 / locate_ok / elev"""
    def __init__(self,route,alt=None,edges=None,feat=None,locate_ok=True,elev=FLATZ,passes=None,ov_fail=False):
        self.route=route;self.alt=alt;self.edges=edges;self.feat=feat or [];self.locate_ok=locate_ok;self.elev=elev;self.passes=passes or []
        self.ov_fail=ov_fail;self.reqs=[];self.tr=[];self.loc=[];self.ov=[];self.errs=[]
    def handler(self,pg):
        def h(route):
            u=route.request.url
            if u.startswith('http://127.0.0.1'):return route.continue_()
            if 'valhalla' in u and u.endswith('/route'):
                body=json.loads(route.request.post_data);self.reqs.append(body)
                j={'trip':{'legs':[{'shape':enc(self.route(body))}]}}
                if body.get('alternates') and self.alt:
                    a=self.alt(body)
                    if a:j['alternates']=[{'trip':{'legs':[{'shape':enc(a)}]}}]
                return route.fulfill(json=j)
            if 'valhalla' in u and 'trace_attributes' in u:
                body=json.loads(route.request.post_data);pts=dec(body['encoded_polyline']);self.tr.append(pts)
                if self.edges is None:return route.fulfill(status=400,json={'error':'x'})
                return route.fulfill(json={'edges':self.edges(pts)})
            if 'valhalla' in u and u.endswith('/locate'):
                body=json.loads(route.request.post_data);self.loc.append(body)
                out=[]
                for l in body['locations']:
                    out.append({'input_lat':l['lat'],'input_lon':l['lon'],'edges':[{'correlated_lat':l['lat'],'correlated_lon':l['lon'],'edge':{'access':{'bicycle':bool(self.locate_ok)}}}]})
                return route.fulfill(json=out)
            if 'overpass' in u:
                q=route.request.post_data or '';self.ov.append(q)
                if self.ov_fail:return route.fulfill(status=500,body='err')
                els=[]
                if 'viewpoint' in q:els=self.feat
                elif 'mountain_pass' in q:els=self.passes
                return route.fulfill(json={'elements':els},headers={'access-control-allow-origin':'*'})
            if 'mreversegeocoder' in u:return route.fulfill(json={'results':{'muniCd':'11201'}})
            if '/xyz/dem/' in u:
                parts=u.split('/dem/13/')[1].replace('.txt','').split('/');return route.fulfill(content_type='text/plain',body=tile(int(parts[0]),int(parts[1]),self.elev))
            return route.fulfill(status=204,body='')
        pg.route('**/*',h)

SUM=[]
def rec(name,env,r):SUM.append((name,len(env.reqs),len(env.tr),len(env.loc),len(env.ov),(r['xlog'] or {}).get('ms'),len(r['cands']),sum(1 for c in r['cands'] if c['auto'])))
PW=sync_playwright().start()
def run(env,obj,pts=None,wait=700):
    b=PW.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
    env.handler(pg)
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    pg.select_option('#obj',obj);pg.wait_for_timeout(100)
    P=pts or [S,G]
    js="__rt.st.points=["+",".join("{lat:%f,lon:%f,name:'P%d',k:'%s'}"%(la,lo,i,'s' if i==0 else 'g' if i==len(P)-1 else 'v') for i,(la,lo) in enumerate(P))+"]"
    pg.evaluate(js);pg.click('#go');pg.wait_for_selector('#cards .card',timeout=40000);pg.wait_for_function('document.querySelector("#cards .stats")',timeout=40000);pg.wait_for_timeout(wait)
    res=pg.evaluate("""({cands:__rt.st.cands.map(c=>({len:c.len,gain:c.gain,auto:!!c.auto,cmf:c.cmf?{Q:c.cmf.Q,H:c.cmf.H,V:c.cmf.V,S:c.cmf.S,ex:c.cmf.excluded||null,walkM:c.cmf.walkM,unk:c.cmf.unk,g:c.cmf.g}:null,pts:c.pts.length})),sel:__rt.st.cands.indexOf(__rt.st.sel),best:__rt.st.cands.indexOf(__rt.st.best),xlog:__rt.st.xlog,text:document.querySelector('#cards').textContent,html:document.querySelector('#cards').innerHTML})""")
    res['errs']=errs
    return res,pg,b
def close(b):b.close()

edgesOf=lambda use='road',rc='residential',mode='bicycle',extra=None:(lambda pts:[dict({'length':plen(pts)/1000,'road_class':rc,'use':use,'travel_mode':mode,'surface':'paved_smooth','lane_count':1,'speed_limit':30},**(extra or {}))])
direct=lambda body:[(l['lat'],l['lon']) for l in body['locations']]
detourN=lambda body:[S,(35.9072,139.1000),G]

# ---------- 1. 通常の快適・絶景: 基本検索1回・属性は候補ごと1回・Overpass1回。静かで景観のよい遠回りを選ぶ ----------
VP=[{'type':'node','lat':35.9072+i*0.0004,'lon':139.1000+i*0.0004,'tags':{'tourism':'viewpoint'}} for i in range(3)]
def edges1(pts):
    busy=max(la for la,lo in pts)<35.901   # 直線ルート=国道、北回り=自転車道
    return [{'length':plen(pts)/1000,'road_class':'primary' if busy else 'residential','use':'road' if busy else 'cycleway','travel_mode':'bicycle','surface':'paved_smooth','lane_count':2 if busy else 1,'speed_limit':50 if busy else 20}]
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
rec('快適・絶景(通常・改善余地なし)',env,r)
print('cmf basic:',[(c['cmf']['Q'],c['cmf']['H'],c['cmf']['V'],c['cmf']['S']) for c in r['cands']],'sel',r['sel'],'routes',len(env.reqs),'trace',len(env.tr),'ov',len(env.ov),'loc',len(env.loc),'xlog',r['xlog'])
ok(len(r['cands'])==2,'候補は直線ルートと遠回りの2本')
ok(r['cands'][0]['cmf']['Q']<r['cands'][1]['cmf']['Q'],'国道は静かさが低く、自転車道は高い')
ok(r['cands'][1]['cmf']['V']>r['cands'][0]['cmf']['V'],'展望地の近くを通る候補は景観が高い')
ok(r['sel']==1 and r['best']==1,'総合スコアの高い、静かで景観のよい遠回りを選ぶ')
ok(r['cands'][1]['len']<r['cands'][0]['len']*1.5,'遠回りは最短の1.5倍以内')
ok(len(env.reqs)>=1 and env.reqs[0]['costing_options']['bicycle']['use_hills']==0.1 and env.reqs[0]['costing_options']['bicycle']['use_roads']==0.1,'基本検索は /route 1回(坂と車道を避ける設定)')
ok(len(env.tr)==2,('属性は候補ごとに1回(2回)',len(env.tr)))
ok(len(env.ov)==1 and 'viewpoint' in env.ov[0] and 'natural"="coastline' in urllib.parse.unquote_plus(env.ov[0]),'景観のOverpassは1回')
for t in env.tr:ok(len(t)>=2,'属性の問い合わせはルートの形状から作り直す')
ok('快適スコア' in r['text'] and '静かさ(推定)' in r['text'] and '激坂の少なさ' in r['text'] and '景観(推定)' in r['text'],'内訳を表示')
ok('実測ではなく' in r['text'] and '最適解を保証するものではありません' in r['text'],'推定・最適解を保証しない旨の注記')
ok('森林・山並みは評価していません' in r['text'],'森林・山並みは対象外と明記')
ok('距離上限' not in r['text'] and not pg.evaluate("!!document.querySelector('input[placeholder*=\"距離\"]')"),'距離上限の入力欄は追加していない')
ok(r['errs']==[],r['errs']);close(b)

# ---------- 2. 距離の上限(最短の1.5倍)と通行止め回避の優先 ----------
farN=lambda body:[S,(35.9300,139.1000),G]   # 約2.3倍の大回り
env=Env(route=direct,alt=farN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
ok(r['cands'][1]['cmf']['ex']=='距離' and r['sel']!=1 and r['cands'][r['sel']]['len']<=r['cands'][0]['len']*1.5+1,('1.5倍を超える候補は、スコアに関係なく除外(選ばれた候補は1.5倍以内)',r['sel']))
close(b)
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
sel0=r['sel']
pg.evaluate("__rt.st.cands[%d].hitsAuto=[{route:'テスト線'}];__rt.choose()"%sel0)
ok(pg.evaluate("__rt.st.cands.indexOf(__rt.st.sel)")!=sel0,'通行止めに当たる候補は、スコアが最高でも選ばない')
pg.evaluate("__rt.st.cands.forEach(c=>c.hitsAuto=[{route:'テスト線'}]);__rt.choose()")
ok(pg.evaluate("__rt.st.sel!=null"),'すべて当たるときは、警告つきで選ぶ(選べないままにしない)')
close(b)
# 通行止めを避けるために長くなった場合は、理由を表示する(通常は表示しない)
env=Env(route=lambda body:[S,(35.9072,139.1000),G],edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
ok('1.5倍を超えています' not in r['text'],'通常は超過の表示なし')
pg.evaluate("__rt.compute._len0=__rt.st.sel.len/1.8;__rt.render(true)")
t=pg.evaluate("document.querySelector('#cards').textContent")
ok('通行止めを避けるため、最短(' in t and '1.5倍を超えています' in t and '通行止めの回避を優先しました' in t,'通行止め回避で1.5倍を超えたときは、理由を表示する');close(b)

# ---------- 3. 通行可否: 押し歩き・階段は静かさに数えない ----------
def edges3(pts):
    L=plen(pts)/1000
    return [{'length':L*0.5,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth'},{'length':L*0.25,'road_class':'residential','use':'steps','travel_mode':'pedestrian','surface':'paved'},{'length':L*0.25,'surface':'paved'}]
env=Env(route=direct,edges=edges3)
r,pg,b=run(env,'cmf')
c=r['cands'][0]['cmf']
ok(abs(c['unk']-0.5)<0.02 and c['walkM']>800,('押し歩き(階段)と通行可否が不明な区間を、静かさに数えない',c))
ok(abs(c['Q']-(1-(0.5*0.2+0.5*0.5))) <0.02,('不明は中立(0.5)',c['Q']))
ok('自転車で走れない可能性のある区間' in r['text'],'押し歩き区間の警告を表示')
close(b)

# ---------- 4. 属性が取れない/景観が取れないとき: 断定しない ----------
env=Env(route=direct,alt=detourN,edges=None,feat=VP)
r,pg,b=run(env,'cmf')
ok(all(c['cmf'].get('Q') is None for c in r['cands'] if c['cmf']),'属性が取れなければ静かさは評価しない(0や1にしない)')
ok('静かさは、道路の属性を取得できなかったため評価していません' in r['text'] or '属性を取得できなかった' in r['text'],'属性が取れなかった旨を表示')
ok(r['sel']>=0 and r['sel']<len(r['cands']),'それでも結果は出る');close(b)
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP,ov_fail=True)
r,pg,b=run(env,'cmf')
ok('景観のデータを取得できませんでした' in r['text'] and '景観は、データを取得できなかったため評価していません' in r['text'],'景観が取れなければ、評価せずにその旨を表示')
ok(all(c['cmf'].get('V') is None for c in r['cands'] if c['cmf'] and not c['cmf'].get('ex')),'景観は0扱いにしない')
ok(r['sel']==1,'景観なしでも、静かさと激坂で比べて結果が出る');close(b)

# ---------- 5. 橋の補正: 谷底を拾う標高で擬似的な急勾配が出ても、橋と確認できれば消える。実在する激坂は消えない ----------
midlon=(S[1]+G[1])/2
def trench(la,lo):   # ルート中央の約200mだけ、DEMが谷底(−60m)を拾う
    return 140.0 if abs(lo-midlon)<0.001 and abs(la-35.9)<0.0008 else 200.0
def edgesBridge(pts):
    L=plen(pts)/1000;a=L*0.5-0.1;
    return [{'length':a,'road_class':'residential','use':'road','travel_mode':'bicycle'},{'length':0.2,'road_class':'residential','use':'road','travel_mode':'bicycle','bridge':True},{'length':L-a-0.2,'road_class':'residential','use':'road','travel_mode':'bicycle'}]
env=Env(route=direct,edges=edgesOf(),elev=trench)
r,pg,b=run(env,'cmf');Hno=r['cands'][0]['cmf']['H'];gno=r['cands'][0]['gain'];n15no=r['cands'][0]['cmf']['g']['n15'];close(b)
env=Env(route=direct,edges=edgesBridge,elev=trench)
r,pg,b=run(env,'cmf');Hb=r['cands'][0]['cmf']['H'];gb=r['cands'][0]['gain'];close(b)
print('bridge: H without flag %.2f gain %s n15 %s / with bridge flag H %.2f gain %s'%(Hno,gno,n15no,Hb,gb))
ok(Hno<0.9 and n15no>=1,'橋と確認できないときは、谷底の標高による急勾配がペナルティになる(実在の激坂と区別できないため消さない)')
ok(Hb>0.99 and gb<gno,'橋と確認できた区間だけ標高を補正すると、擬似的な急勾配と獲得標高の水増しが消える')
# 実在する激坂(橋ではない)は、別の場所に橋があっても残る
def ramp(la,lo):   # 西側の約400mに実在する16%の登り(橋ではない)
    x=(lo-S[1])*90110
    return 200.0+max(0,min(400,x-300))*0.16 if x<700 else 264.0
env=Env(route=direct,edges=edgesBridge,elev=lambda la,lo: ramp(la,lo) if lo<midlon-0.002 else (140.0 if abs(lo-midlon)<0.001 and abs(la-35.9)<0.0008 else 264.0))
r,pg,b=run(env,'cmf');g=r['cands'][0]['cmf']['g']
ok(g['n15']>=1 and g['m15']>=300,('橋を補正しても、実在する15%以上の登りは残る',g))
ok('15%以上の登りが' in r['text'] and '除外していません' in r['text'],'15%以上は警告のみ(除外しない)');close(b)

# ---------- 6. 複数区間・長いルートでも道路属性を取得できる ----------
env=Env(route=direct,edges=edgesOf())
r,pg,b=run(env,'cmf',pts=[S,(35.9,139.1),(35.905,139.11),G])
ok(len(env.tr)>=1 and all(len(t)>=2 for t in env.tr),'経由地つき(3区間相当)のルートでも、形状から属性を取得できる')
ok(pg.evaluate("__rt.st.sel.sfDone")==True and pg.evaluate("__rt.st.sel.paved")==1,'経由地つきでも舗装率を取得できる')
env.tr.clear()
pg.evaluate("""(async()=>{const pts=[];for(let i=0;i<=400;i++)pts.push([35.9,139+i*0.0005]);window.__e=await __rt.attrsOf({pts})})()""");pg.wait_for_timeout(1500)
ok(len(env.tr)==1 and abs(plen(env.tr[0])-plen([(35.9,139+i*0.0005) for i in range(401)]))<5,('約18kmのルートは分割せず1回で問い合わせる',len(env.tr)))
env.tr.clear()
pg.evaluate("""(async()=>{const pts=[];for(let i=0;i<=2000;i++)pts.push([35.9,139+i*0.001]);window.__e=await __rt.attrsOf({pts})})()""");pg.wait_for_timeout(2500)
ok(len(env.tr)>=3 and abs(sum(plen(t) for t in env.tr)-plen([(35.9,139+i*0.001) for i in range(2001)]))<20 and max(plen(t) for t in env.tr)<62000+1500,('約180kmは3回以上に分割し、1回の長さは約60km以下',len(env.tr),max(plen(t) for t in env.tr)));close(b)

# ---------- 7. 共通探索: 快適・絶景(景観の経由地)。確認 /locate は1回、追加 /route は3回以内、代替ルートは使わない ----------
BASE_LAT=35.9
def viaRoute(body):
    return [(l['lat'],l['lon']) for l in body['locations']]
CL=[{'type':'node','lat':35.9036+i*0.0003,'lon':139.1000+i*0.0003,'tags':{'tourism':'viewpoint'}} for i in range(3)]
def edgesQuiet(pts):return [{'length':plen(pts)/1000,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth','lane_count':1,'speed_limit':30}]
env=Env(route=viaRoute,edges=edgesQuiet,feat=CL)
r,pg,b=run(env,'cmf')
rec('快適・絶景(景観の経由地を追加)',env,r)
x=r['xlog'];print('explore cmf:',x,'routes',len(env.reqs))
ok(len(env.loc)==1 and x['locate']==1,'自動経由地の確認(/locate)は1回')
ok(1<len(env.reqs)<=4,('追加の /route は3回以内',len(env.reqs)))
ok(all(not q.get('alternates') for q in env.reqs[1:]),'追加探索では代替ルート(alternates)を使わない')
v=[q for q in env.reqs[1:] if len(q['locations'])>2];ok(v and all(l['type']=='through' for q in v for l in q['locations'][1:-1]) and all(q['locations'][0]['type']=='break' and q['locations'][-1]['type']=='break' for q in v),'経由地はthrough、スタートとゴールはbreak')
ok(all(abs(q['locations'][0]['lat']-S[0])<1e-9 and abs(q['locations'][-1]['lon']-G[1])<1e-9 for q in v),'利用者のスタート・ゴールは動かさない')
ok(any(c['auto'] for c in r['cands']),'追加探索の候補が加わる')
ok(r['cands'][r['sel']]['auto'] and r['cands'][r['sel']]['cmf']['V']>r['cands'][0]['cmf']['V'],'景観が改善した追加候補が選ばれる')
ok('追加探索の候補です' in r['text'] and '追加探索:' in r['text'],'追加探索の候補であることを表示')
ok(r['errs']==[],r['errs']);close(b)
# 自転車で通れると確認できない経由地は使わない
env=Env(route=viaRoute,edges=edgesQuiet,feat=CL,locate_ok=False)
r,pg,b=run(env,'cmf')
ok(len(env.reqs)==1 and r['xlog']['routes']==0 and not any(c['auto'] for c in r['cands']),('自転車で通れると確認できない経由地は使わず、追加の/routeもしない',len(env.reqs)))
ok('確認できなかったため使いません' in (r['xlog']['note'] or ''),r['xlog']);close(b)

# ---------- 8. 共通探索: 最大獲得標高(峠)。基本候補は上限なし、自動候補だけ最短の2倍まで ----------
PX=(35.9150,139.1000)
def hill(la,lo):
    d=math.hypot((la-PX[0])*111195,(lo-PX[1])*90110);return 200.0+250.0*max(0,1-d/2600)
PASS=[{'type':'node','lat':PX[0],'lon':PX[1],'tags':{'natural':'peak','ele':'450','name':'テスト峠'}}]
env=Env(route=viaRoute,edges=edgesQuiet,passes=PASS,elev=hill)
r,pg,b=run(env,'max')
rec('最大獲得標高(峠を追加)',env,r)
x=r['xlog'];print('explore max:',x,'gains',[c['gain'] for c in r['cands']])
ok(len(env.reqs)==2 and x['routes']==1 and len(env.loc)==1,('通常検索は1回+追加探索1回(最大獲得標高)',len(env.reqs)))
ok(r['cands'][r['sel']]['auto'] and r['cands'][r['sel']]['gain']>r['cands'][0]['gain']+50,'峠を経由した追加候補の獲得標高が大きく、選ばれる')
ok(r['cands'][r['sel']]['len']<=r['cands'][0]['len']*2.0+1,'自動の追加候補は、最短の2倍以内')
ok(env.reqs[0]['locations'].__len__()==2,'基本検索は2地点のみ')
close(b)
# 峠が遠すぎて2倍を超えるときは使わない
FAR=[{'type':'node','lat':35.9,'lon':139.1000,'tags':{'natural':'peak','ele':'900'}}]
PXf=(35.9400,139.1000)
env=Env(route=viaRoute,edges=edgesQuiet,passes=[{'type':'node','lat':PXf[0],'lon':PXf[1],'tags':{'natural':'peak','ele':'900'}}],elev=lambda la,lo:200.0)
r,pg,b=run(env,'max')
ok(len(env.reqs)==1 and not any(c['auto'] for c in r['cands']),('最短の2倍を超える見込みの峠は使わない',len(env.reqs)));close(b)
# 峠のデータがないときは、追加探索なし
env=Env(route=viaRoute,edges=edgesQuiet,passes=[])
r,pg,b=run(env,'max')
ok(len(env.reqs)==1 and len(env.loc)==0,'峠がなければ追加探索なし(通常検索1回のまま)');close(b)

# ---------- 9. 共通探索: 最小獲得標高(急坂に除外点)。除外点は利用者の地点の近くに置かない ----------
def ridge(la,lo):
    x=(lo-S[1])*90110
    if abs(la-35.9)<0.0010:
        if 1500<x<1900:return 200.0+(x-1500)*0.15
        if 1900<=x<2300:return 260.0-(x-1900)*0.15
    return 200.0
def dodge(body):
    ex=body.get('exclude_locations') or []
    hit=any(abs(e['lat']-35.9)<0.0012 and 139.0960<e['lon']<139.1040 for e in ex)
    if hit:return [S,(35.9040,139.0950),(35.9040,139.1050),G]
    return [(l['lat'],l['lon']) for l in body['locations']]
env=Env(route=dodge,edges=edgesQuiet,elev=ridge)
r,pg,b=run(env,'min')
rec('最小獲得標高(急坂に除外点)',env,r)
x=r['xlog'];print('explore min:',x,'gains',[c['gain'] for c in r['cands']])
ok(len(env.reqs)>=2 and x['routes']>=1,'急坂があるので、追加探索を行う')
ex=env.reqs[1].get('exclude_locations') or []
ok(any(abs(e['lat']-35.9)<0.0015 and 139.09<e['lon']<139.11 for e in ex),'急坂の位置に除外点を置く')
ok(all(hav((e['lat'],e['lon']),S)>300 and hav((e['lat'],e['lon']),G)>300 for e in ex[-3:]),'利用者の地点の近く(300m以内)には除外点を置かない')
ok(r['cands'][r['sel']]['gain']<r['cands'][0]['gain'],'急坂を避けた追加候補は獲得標高が小さく、最小獲得標高として選ばれる')
ok(len(env.loc)==0,'除外点は /locate で確認しない(Valhallaが道路に吸着するため)');close(b)
# 急坂がなければ追加探索なし
env=Env(route=direct,edges=edgesQuiet,elev=FLATZ)
r,pg,b=run(env,'min')
rec('最小獲得標高(改善余地なし)',env,r)
ok(len(env.reqs)==1 and r['xlog']['routes']==0,'改善の余地がなければ追加探索なし(通常検索 /route 1回のまま)');close(b)
# ---------- 10. 自転車で走れると確認できた候補を優先する(押し歩き・階段の多い候補は、スコアが高くても、ほかに候補があれば選ばない) ----------
def edgesWalky(pts):
    busy=max(la for la,lo in pts)<35.901;L=plen(pts)/1000
    if busy:return [{'length':L,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth'}]
    return [{'length':L*0.6,'road_class':'residential','use':'cycleway','travel_mode':'bicycle'},{'length':L*0.4,'use':'steps','travel_mode':'pedestrian'}]
env=Env(route=direct,alt=detourN,edges=edgesWalky,feat=[])
r,pg,b=run(env,'cmf')
ok(r['cands'][1]['cmf']['walkM']>500 and r['sel']==0,('押し歩き区間が長い候補より、走れると確認できた候補を選ぶ',r['sel'],[c['cmf'].get('walkM') for c in r['cands']]));close(b)
# ---------- 11. 最小獲得標高でも、橋と確認できた区間の標高補正を、選んだルートに適用する(追加の問い合わせは増やさない) ----------
env=Env(route=direct,edges=edgesBridge,elev=trench)
r,pg,b=run(env,'min',wait=1200)
t=pg.evaluate("document.querySelector('#cards').textContent");g=pg.evaluate("__rt.st.sel.gain")
ok('橋・トンネルと確認できた区間の標高を補正済み' in t and g==0,('最小獲得標高でも、選んだルートの橋の補正が反映される',g))
ok(len(env.tr)==1 and len(env.reqs)==1,'属性の取得は選んだルートの1回のまま')
close(b)
env=Env(route=direct,edges=edgesOf(),elev=trench)
r,pg,b=run(env,'min',wait=1200);t=pg.evaluate("document.querySelector('#cards').textContent")
ok('補正済み' not in t and pg.evaluate("__rt.st.sel.gain")>0,'橋の根拠がなければ補正しない(標高は変えない)');close(b)
# ---------- 12. 再読み込み後の復元(快適・絶景) ----------
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
pg.evaluate("localStorage.setItem('rt-state',JSON.stringify({points:__rt.st.points,closures:[],detour:'1.5',obj:'cmf'}))")
pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000);pg.wait_for_selector('#cards .stats',timeout=20000);pg.wait_for_timeout(500)
t=pg.evaluate("document.querySelector('#cards').textContent")
ok(pg.input_value('#obj')=='cmf' and '快適スコア' in t,'再読み込み後も、選択と快適・絶景の結果が復元される');close(b)
# 追加探索の無効化(rt-explore=0)
env=Env(route=dodge,edges=edgesQuiet,elev=ridge)
b=PW.chromium.launch();pg=b.new_page();env.handler(pg)
pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.evaluate("localStorage.setItem('rt-explore','0')");pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
pg.select_option('#obj','min');pg.evaluate("__rt.st.points=[{lat:%f,lon:%f,k:'s'},{lat:%f,lon:%f,k:'g'}]"%(S+G));pg.click('#go');pg.wait_for_selector('#cards .card',timeout=30000);pg.wait_for_timeout(500)
ok(len(env.reqs)==1,'rt-explore=0 で追加探索を止められる');b.close();PW.stop()
print('--- API回数(模擬): 場面 / /route / trace_attributes / /locate / Overpass / 追加探索ms / 候補数 / うち追加候補')
for x in SUM:print('  ',*x)
print('全 %d 件OK (comfort-flow)'%n)
