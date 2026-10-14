"""地点の入力: 経由地を入れたあとに目的地を入れても、経由地が消えない。並びは常に [出発, 経由…, 目的地]。"""
import json,threading,http.server,socketserver,functools,os,urllib.parse
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(type('Q',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *a:None}),directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
PL={'飯能':('35.851','139.319'),'西武秩父駅':('35.9897','139.0838'),'十石峠':('36.1064','138.6476'),'秩父駅':('35.9986','139.0857')}
n=0
def ok(c,m):
    global n;assert c,m;n+=1
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    def h(r):
        u=r.request.url
        if u.startswith('http://127.0.0.1'):return r.continue_()
        if 'nominatim' in u:
            q=urllib.parse.unquote(u.split('q=')[1]);la,lo=PL[q]
            return r.fulfill(json=[{'class':'place','type':'city','name':q,'address':{'state':'埼玉県'},'display_name':q,'lat':la,'lon':lo}],headers={'access-control-allow-origin':'*'})
        return r.fulfill(status=204,body='')
    pg.route('**/*',h);pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    def add(q,k):
        pg.fill('#q',q);pg.click('#qgo');pg.wait_for_selector('#sr li button[data-k=%s]'%k,timeout=5000);pg.click('#sr li button[data-k=%s]'%k);pg.wait_for_timeout(150)
    def pts():return pg.evaluate("__rt.st.points.map(p=>p.k+':'+p.name)")
    def badges():return pg.evaluate("[...document.querySelectorAll('#pts li')].map(li=>li.querySelector('.badge').textContent+li.querySelector('.hint').textContent.split('・')[0].trim())")
    pg.evaluate("__rt.st.points=[];localStorage.removeItem('rt-state')");pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    # 1) 経由 → 目的地 → 出発 の順に入れても、全部残り、並びは [出発, 経由, 目的地]
    add('十石峠','v');add('秩父駅','g')
    ok(pts()==['v:十石峠','g:秩父駅'],pts())
    pg.click('#go');pg.wait_for_timeout(300)
    ok('出発地と目的地' in pg.inner_text('#st'),pg.inner_text('#st'))
    add('飯能','s')
    ok(pts()==['s:飯能','v:十石峠','g:秩父駅'],pts())
    ok(badges()==['S出発','1経由','G目的地'],badges())
    # 2) 出発 → 経由 → 目的地(報告された操作)
    pg.click('#clr');pg.wait_for_timeout(100)
    add('飯能','s');add('十石峠','v');add('西武秩父駅','g')
    ok(pts()==['s:飯能','v:十石峠','g:西武秩父駅'],pts())
    # 3) 目的地を入れ直すと、目的地だけが置き換わる。経由を2つ入れると番号が付く
    add('秩父駅','g');ok(pts()==['s:飯能','v:十石峠','g:秩父駅'],pts())
    add('西武秩父駅','v');ok(pts()==['s:飯能','v:十石峠','v:西武秩父駅','g:秩父駅'],pts());ok(badges()==['S出発','1経由','2経由','G目的地'],badges())
    # 4) 入れ替え: 出発と目的地だけが入れ替わる
    pg.click('#swap');pg.wait_for_timeout(150);ok(pts()==['s:秩父駅','v:西武秩父駅','v:十石峠','g:飯能'],pts())
    # 5) 保存と再読み込み
    pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000);ok(pts()==['s:秩父駅','v:西武秩父駅','v:十石峠','g:飯能'],pts())
    # 6) 印のない古い保存データ: 先頭=出発、末尾=目的地、間=経由
    pg.evaluate("localStorage.setItem('rt-state',JSON.stringify({points:[{lat:35.85,lon:139.31,name:'A'},{lat:35.9,lon:139.2,name:'B'},{lat:35.99,lon:139.08,name:'C'}],closures:[]}))");pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    ok(pts()==['s:A','v:B','g:C'],pts())
    ok(errs==[],errs);b.close()
print('全 %d 件OK (points-flow)'%n)
