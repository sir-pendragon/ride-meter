"""場所検索の結果の整形: 種類・住所を付け、ホーム等の細かい点と重複を除く(Nominatimの応答は手元の見本。実サーバーの応答ではない)。"""
import json,threading,http.server,socketserver,functools,os
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(type('Q',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *a:None}),directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
def X(cls,typ,name,addr,disp,lat='35.85',lon='139.32'):return {'class':cls,'type':typ,'name':name,'address':addr,'display_name':disp,'lat':lat,'lon':lon}
HANNO=[X('railway','station','飯能',{'state':'埼玉県','city':'飯能市','suburb':'八幡町','road':'材木通り'},'飯能, 材木通り, 八幡町, 飯能市, 埼玉県, 日本'),
 X('railway','platform','飯能02.03',{'state':'埼玉県','city':'飯能市','suburb':'八幡町'},'飯能02.03, 八幡町, 飯能市'),
 X('railway','platform','飯能05',{'state':'埼玉県','city':'飯能市','suburb':'八幡町'},'飯能05, 八幡町, 飯能市'),
 X('public_transport','platform','飯能01',{'state':'埼玉県','city':'飯能市','suburb':'八幡町'},'飯能01, 八幡町, 飯能市'),
 X('place','city','飯能市',{'state':'埼玉県','city':'飯能市'},'飯能市, 埼玉県, 日本','35.86','139.33'),
 X('place','suburb','飯能',{'state':'埼玉県','city':'飯能市','suburb':'大字飯能'},'飯能, 大字飯能, 飯能市, 埼玉県','35.85','139.31'),
 X('place','suburb','飯能',{'state':'埼玉県','city':'飯能市','suburb':'大字飯能'},'飯能, 大字飯能, 飯能市, 埼玉県','35.85','139.31')]
n=0
def ok(c,m):
    global n;assert c,m;n+=1
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[];qs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    def h(r):
        u=r.request.url
        if u.startswith('http://127.0.0.1'):return r.continue_()
        if 'nominatim' in u:qs.append(u);return r.fulfill(json=HANNO,headers={'access-control-allow-origin':'*'})
        return r.fulfill(status=204,body='')
    pg.route('**/*',h);pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    pg.fill('#q','飯能');pg.click('#qgo');pg.wait_for_selector('#sr li button',timeout=5000)
    rows=pg.evaluate("[...document.querySelectorAll('#sr li')].map(li=>[li.querySelector('.nm').textContent,li.querySelector('.hint.nm').textContent])")
    print(rows)
    ok('addressdetails=1' in qs[0],qs[0])
    ok(not any('02.03' in r[0] or '飯能05' in r[0] or '飯能01' in r[0] for r in rows),'ホーム等は出さない')
    ok(len(rows)==3,('重複を除いて3件',rows))
    ok(rows[0][0]=='飯能駅' and rows[0][1]=='埼玉県飯能市八幡町 材木通り',rows[0])
    ok(len({tuple(r) for r in rows})==len(rows),'同じ表示が並ばない')
    # 「駅」で終わる検索は駅を先頭に
    pg.fill('#q','飯能駅');pg.click('#qgo');pg.wait_for_timeout(500)
    first=pg.evaluate("document.querySelector('#sr li .nm').textContent")
    ok(first.startswith('飯能駅'),first)
    # 目的地に選ぶと「飯能駅」で登録される
    pg.evaluate("__rt.st.points=[]");pg.click('#sr li:first-child button[data-k=g]');pg.wait_for_timeout(300)
    ok(pg.evaluate("__rt.st.points.map(p=>p.name)")==['飯能駅'],'選ぶと名前が飯能駅')
    ok(errs==[],errs);b.close()
print('全 %d 件OK (search-format)'%n)
