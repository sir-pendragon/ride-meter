import json,sys,time,threading,http.server,socketserver,os,functools,re
from playwright.sync_api import sync_playwright
ROOT=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'..','..','route')
FAKE=open('/home/claude/ride-meter/tests/e2e/fake-google-maps.js',encoding='utf-8').read()
import sys
MODE=sys.argv[1] if len(sys.argv)>1 else 'ok'
OUT=len(sys.argv)>2 and sys.argv[2]=='out'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
H=functools.partial(Q,directory=ROOT)
srv=socketserver.TCPServer(('127.0.0.1',0),H);srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
def enc(pts):
    out='';pl=pla=0;plo=0
    for la,lo in pts:
        a=round(la*1e6);b=round(lo*1e6)
        for d in (a-pla,b-plo):
            d=~(d<<1) if d<0 else d<<1
            while d>=0x20:
                out+=chr((0x20|(d&0x1f))+63);d>>=5
            out+=chr(d+63)
        pla,plo=a,b
    return out
# 閉鎖する道(広河原線)と、ルートA(閉鎖を通る)・ルートB(迂回)
CLOSED=[(35.9000,139.0900),(35.9010,139.0950),(35.9020,139.1000),(35.9030,139.1050)]
ROUTE_A=[(35.8990,139.0850),*CLOSED,(35.9040,139.1100)]
ROUTE_B=[(35.8990,139.0850),(35.8900,139.0950),(35.8900,139.1050),(35.9040,139.1100)]
HTML='''<html><body><p>掲載日：2026年10月1日</p><table><tr><th>路線名</th><th>通行制限の種類</th><th>通行制限区間(位置)</th><th>通行制限の期間</th><th>通行制限事由</th></tr>
<tr><td>広河原線</td><td>一部区間通行止め</td><td>上落合橋～志賀坂峠</td><td>当面の間</td><td>落石多発のため</td></tr>
<tr><td>長久保線</td><td>一部区間通行止め</td><td>起点より3.5km~終点</td><td>当面の間</td><td>崩落</td></tr></table></body></html>'''
GF={'ok':"(r)=>{const m={'上落合橋':[35.9000,139.0900],'志賀坂峠':[35.9030,139.1050]};for(const k in m)if(r.address.includes(k))return{results:[{partial_match:false,geometry:{location:{lat:()=>m[k][0],lng:()=>m[k][1]}}}]};return{results:[]}}",
 'far':"(r)=>({results:[{partial_match:false,geometry:{location:{lat:()=>35.5,lng:()=>139.5}}}]})",
 'denied':"(r)=>{const e=new Error('REQUEST_DENIED');e.code='REQUEST_DENIED';throw e}",
 'gsi':"(r)=>{window.__geoCalls=(window.__geoCalls||0)+1;return{results:[]}}",
 'over':"(r)=>{window.__geoCalls=(window.__geoCalls||0)+1;const e=new Error('OVER_QUERY_LIMIT');e.code='OVER_QUERY_LIMIT';throw e}"}[MODE]
def run(honor):
    reqs=[]
    with sync_playwright() as p:
        b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
        def h(route):
            u=route.request.url
            if 'maps.googleapis.com' in u: return route.fulfill(content_type='text/javascript',body=FAKE)
            if 'relay.test' in u:
                return route.fulfill(status=200,headers={'content-type':'text/html','access-control-allow-origin':'*','x-fetched-at':'2026-10-14T00:00:00Z','x-upstream-status':'200','access-control-expose-headers':'*'},body=HTML)
            if 'mreversegeocoder' in u:
                return route.fulfill(json={'results':{'muniCd':'11208'}})
            if 'overpass' in u:
                els=[{'type':'way','id':1,'tags':{'name':'林道広河原線','highway':'track'},'geometry':[{'lat':a,'lon':o} for a,o in CLOSED]},{'type':'way','id':2,'tags':{'name':'林道長久保線','highway':'track'},'geometry':[{'lat':35.95,'lon':139.2},{'lat':35.96,'lon':139.21}]}]
                return route.fulfill(json={'elements':els})
            if 'valhalla' in u and u.endswith('/route'):
                body=json.loads(route.request.post_data);reqs.append(body)
                ex=body.get('exclude_locations') or []
                avoid=honor and any(abs(e['lat']-c[0])<0.002 and abs(e['lon']-c[1])<0.002 for e in ex for c in CLOSED)
                pts=ROUTE_B if avoid else ROUTE_A
                return route.fulfill(json={'trip':{'legs':[{'shape':enc(pts)}],'summary':{'length':3}}})
            if 'valhalla' in u and 'trace_attributes' in u: return route.fulfill(json={'edges':[{'surface':'paved_smooth','length':3}]})
            if 'valhalla' in u: return route.fulfill(status=400,json={'error':'x'})
            if 'cyberjapandata' in u and '/dem/' in u: return route.fulfill(headers={'access-control-allow-origin':'*'},body='\n'.join(','.join(str(100+i//4) for i in range(256)) for _ in range(256)))
            if 'cyberjapandata' in u: return route.fulfill(status=404,body='')
            if 'msearch.gsi.go.jp' in u:
                if MODE!='gsi': return route.fulfill(json=[])
                from urllib.parse import unquote
                q=unquote(u.split('q=')[1]);m={'上落合橋':[35.9000,139.0900],'志賀坂峠':[35.9030,139.1050]}
                if q=='志賀坂峠' and MODE=='gsi' and OUT:
                    return route.fulfill(headers={'access-control-allow-origin':'*'},json=[{'type':'Feature','properties':{'title':q},'geometry':{'type':'Point','coordinates':[140.0,43.0]}}])
                if q in m:
                    return route.fulfill(headers={'access-control-allow-origin':'*'},json=[{'type':'Feature','properties':{'title':q},'geometry':{'type':'Point','coordinates':[m[q][1],m[q][0]]}},{'type':'Feature','properties':{'title':q},'geometry':{'type':'Point','coordinates':[140.0,43.0]}}])
                return route.fulfill(headers={'access-control-allow-origin':'*'},json=[])
            if 'nominatim' in u: return route.fulfill(json=[])
            if '127.0.0.1' in u: return route.continue_()
            return route.fulfill(status=204,body='')
        pg.add_init_script('window.__geocodeFake='+GF+';try{localStorage.setItem("rt-gkey","k")}catch(e){}')
        pg.route('**/*',h)
        pg.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1] + '');pg.wait_for_function('typeof __rt!=="undefined"',timeout=15000)
        pg.evaluate("""()=>{localStorage.setItem('rt-relay','https://relay.test');localStorage.removeItem('rt-confirmed');
          __rt.st.points=[{lat:35.8990,lon:139.0850,name:'S'},{lat:35.9040,lon:139.1100,name:'G'}]}""")
        pg.reload();pg.wait_for_function("typeof __rt!==\"undefined\"",timeout=15000)
        pg.evaluate("()=>{__rt.st.points=[{lat:35.8990,lon:139.0850,name:'S'},{lat:35.9040,lon:139.1100,name:'G'}]}")
        pg.evaluate('__rt.compute()');pg.wait_for_selector('#ac-list li',timeout=30000);pg.wait_for_selector('#cards .card',timeout=30000);time.sleep(0.5)
        print('AUTO fetched without button; relay hits:',sum(1 for _ in [0]))
        print('status:',pg.inner_text('#ac-st')[:300])
        print('kind:',pg.evaluate('window.__map.kind'));print('STATUS-FULL:',pg.inner_text('#ac-st')[:900])
        print('list:',pg.inner_text('#ac-list').replace('\n',' / ')[:600])
        if MODE=='ok':
            pg.evaluate('Closures._test.avoid(0)');time.sleep(0.5)
        if MODE=='gsi':
            print('gsi: google calls =',pg.evaluate('window.__geoCalls||0'),'/ gsi basis shown =','国土地理院の検索' in pg.inner_text('#ac-list'))
        if MODE=='over':
            print('over-limit: geocode calls =',pg.evaluate('window.__geoCalls||0'),'/ flag saved =',pg.evaluate('!!localStorage.getItem("rt-geo-over")'),'/ note shown =','上限に達している' in pg.inner_text('#ac-st')+pg.inner_text('#cards'))
        print('errors:',errs);b.close()
for honor in (True,False):
    print('=== 除外を守るサーバー' if honor else '=== 除外を無視するサーバー');run(honor)
