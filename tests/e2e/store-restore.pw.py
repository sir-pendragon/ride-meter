"""ブラウザのサイトデータ(localStorage)が消えても、IndexedDB の複製 / config.js の予備からキーが戻ることを確認する。"""
import threading,http.server,socketserver,functools,os
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
FAKE=open(os.path.join(os.path.dirname(__file__),'fake-google-maps.js')).read()
URL='http://127.0.0.1:%d/index.html'%srv.server_address[1]
n=0
def ok(c,m):
    global n;assert c,m;n+=1
def h(route):
    u=route.request.url
    if 'maps.googleapis.com' in u:return route.fulfill(content_type='text/javascript',body=FAKE)
    if u.startswith('http://127.0.0.1'):return route.continue_()
    return route.fulfill(status=200,content_type='text/plain',body='',headers={'access-control-allow-origin':'*'})
with sync_playwright() as p:
    b=p.chromium.launch();ctx=b.new_context(viewport={'width':412,'height':915});pg=ctx.new_page();errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)));pg.route('**/*',h)
    # 1) 画面から保存 → Google モード
    pg.goto(URL);pg.wait_for_timeout(800)
    pg.evaluate("document.getElementById('set-toggle').click()")
    pg.fill('#gk-key','AIzaSAVED');pg.click('#gk-save');pg.wait_for_timeout(1800)
    ok(pg.evaluate('window.__map.kind')=='google','保存後に google')
    # 2) localStorage だけ消す(キャッシュ削除の再現) → IndexedDB から復元
    pg.evaluate("localStorage.clear()");pg.reload();pg.wait_for_timeout(1500)
    ok(pg.evaluate('window.__map.kind')=='google','localStorage 消失後も google (IndexedDB から復元)')
    ok(pg.evaluate("localStorage.getItem('rt-gkey')")=='AIzaSAVED','localStorage に戻る')
    ok(pg.evaluate('window.__rtStore.restored["rt-gkey"]')=='idb','復元元は idb')
    # 3) 両方消す → 地理院地図(予備なし)
    pg.evaluate("localStorage.clear();indexedDB.deleteDatabase('rt-store')");pg.wait_for_timeout(300)
    pg.reload();pg.wait_for_timeout(1500)
    ok(pg.evaluate('window.__map.kind')=='leaflet','両方消えたら leaflet(config 予備なし)')
    # 4) config.js に予備のキーがある場合
    pg.route('**/config.js',lambda r:r.fulfill(content_type='text/javascript',body="window.RT_CONFIG={gmapsKey:'AIzaCFG',relayUrl:'https://relay.cfg'}"))
    pg.evaluate("localStorage.clear();indexedDB.deleteDatabase('rt-store')");pg.wait_for_timeout(300)
    pg.reload();pg.wait_for_timeout(1500)
    ok(pg.evaluate('window.__map.kind')=='google','config 予備のキーで google')
    ok(pg.evaluate("localStorage.getItem('rt-relay')")=='https://relay.cfg','relay も config から復元')
    # 5) 端末側の値が config より優先
    pg.evaluate("localStorage.setItem('rt-gkey','AIzaLOCAL')");pg.reload();pg.wait_for_timeout(1200)
    ok(pg.evaluate("localStorage.getItem('rt-gkey')")=='AIzaLOCAL','端末の値が優先')
    ok(errs==[],errs)
    b.close()
print('全 %d 件OK (store-restore)'%n)
