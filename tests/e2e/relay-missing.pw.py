"""中継のURLが端末に無いとき、「通行止めの確認」に、理由と入力ボタンを出す(失敗の羅列にしない)。"""
import threading,http.server,socketserver,functools,os
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(type('Q',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *a:None}),directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
n=0
def ok(c,m):
    global n;assert c,m;n+=1
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.route('**/*',lambda r:r.continue_() if '127.0.0.1' in r.request.url else r.fulfill(status=204,body=''))
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    ok(not pg.evaluate("Closures.hasRelay()"),'中継URLなし')
    pg.evaluate("__rt.st.sel={pts:[[35.9,139.1],[35.91,139.11]]};__rt.renderClFound()")
    t=pg.inner_text('#cl-found');print(t.replace('\n',' / '))
    ok('通行止めを取得できません' in t and '中継のURLが入っていません' in t,t)
    ok('とは言えません' in t and not pg.evaluate("!!document.querySelector('#cl-found .badge')"),'「通行規制なし」の表示は出さない')
    ok(pg.evaluate("document.getElementById('set-box').hidden"),'設定は閉じている')
    pg.click('#cl-found [data-a=openrelay]');pg.wait_for_timeout(300)
    ok(not pg.evaluate("document.getElementById('set-box').hidden"),'押すと設定が開く')
    ok(pg.evaluate("document.activeElement&&document.activeElement.id")=='ac-relay','中継の入力欄にカーソル')
    # URLを入れて保存すると、このメッセージは出なくなる
    pg.fill('#ac-relay','https://relay.example.workers.dev');pg.click('#ac-save');pg.wait_for_timeout(300)
    pg.evaluate("__rt.renderClFound()");ok('通行止めを取得できません' not in pg.inner_text('#cl-found'),'URL保存後は出ない')
    ok(errs==[],errs);b.close()
print('全 %d 件OK (relay-missing)'%n)
