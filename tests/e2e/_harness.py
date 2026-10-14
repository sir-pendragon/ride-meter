from http_test_server import TestServer
"""快適・絶景/共通探索のe2e用の共通部品(模擬サーバー)。このファイル自体はテストではない。"""
import urllib.parse,json,time,threading,http.server,socketserver,os,functools,math
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
srv=TestServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
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
    def __init__(self,route,alt=None,edges=None,feat=None,locate_ok=True,elev=FLATZ,passes=None,ov_fail=False,cyc=None):
        self.route=route;self.alt=alt;self.edges=edges;self.feat=feat or [];self.locate_ok=locate_ok;self.elev=elev;self.passes=passes or []
        self.ov_fail=ov_fail;self.cyc=cyc or [];self.reqs=[];self.tr=[];self.loc=[];self.ov=[];self.errs=[]
    def handler(self,pg):
        def h(route):
            u=route.request.url
            if u.startswith('http://127.0.0.1'):return route.continue_()
            if 'googleapis.com' in u or 'gstatic.com' in u:return route.abort()   # Googleマップの読み込み待ち(10秒)を省く。地理院地図で動く
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
                edges=self.edges(pts);dist=[0]
                for i in range(1,len(pts)):dist.append(dist[-1]+hav(pts[i-1],pts[i]))
                acc=0
                for edge in edges:
                    end=acc+edge.get('length',0)*1000
                    edge.setdefault('begin_shape_index',min(range(len(dist)),key=lambda i:abs(dist[i]-acc)))
                    edge.setdefault('end_shape_index',min(range(len(dist)),key=lambda i:abs(dist[i]-end)))
                    acc=end
                return route.fulfill(json={'shape':body['encoded_polyline'],'edges':edges})
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
                elif 'route' in urllib.parse.unquote_plus(q) and 'bicycle' in urllib.parse.unquote_plus(q):els=self.cyc
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

def done(name):
    global PW
    try:PW.stop()
    except Exception:pass
    if SUM:
        print('--- API回数(模擬): 場面 / /route / trace_attributes / /locate / Overpass / 追加探索ms / 候補数 / うち追加候補')
        for x in SUM:print('  ',*x)
    print('全 %d 件OK (%s)'%(n,name))

