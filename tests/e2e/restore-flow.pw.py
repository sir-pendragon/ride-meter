"""計算したルートの復元: 画面が読み込み直されても、同じ地点なら結果が戻る。地点が違えば戻らない。"""
import json,threading,http.server,socketserver,functools,os
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(type('Q',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *a:None}),directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
DEM='\n'.join(','.join(str(100+i%7) for i in range(256)) for _ in range(256))
n=0
def ok(c,m):
    global n;assert c,m;n+=1
def h(r):
    u=r.request.url
    if u.startswith('http://127.0.0.1'):return r.continue_()
    if '/xyz/dem/' in u:return r.fulfill(content_type='text/plain',body=DEM,headers={'access-control-allow-origin':'*'})
    return r.fulfill(status=204,body='')
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)));pg.route('**/*',h)
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    pts=[{'lat':35.85,'lon':139.31,'name':'A','k':'s'},{'lat':35.99,'lon':139.08,'name':'B','k':'g'}]
    route=[[35.85+i*0.0014,139.31-i*0.0023] for i in range(101)]
    pg.evaluate("([P,R])=>{localStorage.setItem('rt-state',JSON.stringify({points:P,closures:[],obj:'max'}));localStorage.setItem('rt-last',JSON.stringify({key:P.map(p=>p.k+p.lat.toFixed(5)+','+p.lon.toFixed(5)).join('|')+'#max',pts:R}))}",[pts,route])
    pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    pg.wait_for_selector('#cards .card',timeout=20000)
    ok(pg.evaluate("__rt.st.sel.pts.length")==101,'保存したルートが戻る')
    ok(pg.is_visible('#s-res'),'結果が表示される')
    # 地点が違えば復元しない
    pg.evaluate("()=>{const s=JSON.parse(localStorage.getItem('rt-state'));s.points[1].lat=36.0;localStorage.setItem('rt-state',JSON.stringify(s))}")
    pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000);pg.wait_for_timeout(800)
    ok(pg.evaluate("__rt.st.cands.length")==0 and not pg.is_visible('#s-res'),'地点が違えば復元しない')
    ok(errs==[],errs);b.close()
print('全 %d 件OK (restore-flow)'%n)
