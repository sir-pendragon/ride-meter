"""Real browser SW activation/update, with local fixtures and isolated storage."""
import functools,http.server,pathlib,threading
from http_test_server import TestServer
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]/'route'
version={'value':'route-v57.1'}
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path.endswith('/sw.js'):
            data=(ROOT/'sw.js').read_text(encoding='utf-8').replace('route-v57.1',version['value']).encode()
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
        elif self.path.endswith('/config.js'):
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(b'window.RT_CONFIG={gmapsKey:"",relayUrl:""}')
        else:super().do_GET()
server=TestServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch();page=browser.new_page()
    page.route('**/*',lambda r:r.continue_() if '127.0.0.1' in r.request.url else r.fulfill(status=204,body=''))
    page.goto('http://127.0.0.1:%d/index.html'%server.server_address[1]);page.wait_for_function('typeof __rt!=="undefined"')
    page.evaluate("Promise.all(['route-v56','rt-scn','rt-cyc','rt-dem','note-v8','meter-v10'].map(k=>caches.open(k)))")
    page.evaluate("navigator.serviceWorker.register('sw.js')")
    page.wait_for_function('navigator.serviceWorker.controller!==null')
    keys=page.evaluate('caches.keys()')
    assert 'route-v56' not in keys and all(k in keys for k in ['route-v57.1','rt-scn','rt-cyc','rt-dem','note-v8','meter-v10']),keys
    version['value']='route-v57.2'
    page.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update())')
    page.wait_for_function("caches.keys().then(k=>k.includes('route-v57.2')&&!k.includes('route-v57.1'))")
    keys=page.evaluate('caches.keys()')
    assert all(k in keys for k in ['rt-scn','rt-cyc','rt-dem','note-v8','meter-v10']),keys
    page.reload();page.wait_for_function('typeof __rt!=="undefined"')
    browser.close()
server.shutdown()
print('全 3 件OK (sw-update)')
