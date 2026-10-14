"""tools/muni_inventory.py の判定を、ローカルの模擬サイトで確認する(外部通信なし)。"""
import http.server, socketserver, threading, sys, os, importlib.util
spec = importlib.util.spec_from_file_location('mi', os.path.join(os.path.dirname(__file__), '..', 'tools', 'muni_inventory.py'))
mi = importlib.util.module_from_spec(spec); spec.loader.exec_module(mi)

TOP = '<html><head><title>テスト町</title></head><body><a href="/bosai/">防災・安全</a><a href="/doro/">道路の通行止め情報</a><a href="/kanko/">観光</a></body></html>'
DORO = '<html><head><title>道路の通行止め情報</title></head><body><a href="/doro/rindo.html">林道通行規制</a><p>更新 令和8年9月24日</p></body></html>'
RIN = '<html><head><title>林道通行止め一覧</title></head><body><table><tr><th>路線</th><th>区間</th></tr><tr><td>東山林道</td><td>全線</td></tr></table><p>令和8年9月24日現在 令和8年10月1日</p></body></html>'
IDX = '<html><head><title>案内</title></head><body><p>通行規制はこちらの担当課へ</p></body></html>'
NOPE = '<html><body><a href="/x">観光</a></body></html>'
SJIS = '<html><head><meta charset="Shift_JIS"><title>道路</title></head><body><table><tr><td>通行止め 令和8年1月1日 令和8年2月2日</td></tr></table></body></html>'.encode('cp932')
PAGES = {'/top': TOP, '/bosai/': IDX, '/doro/': DORO, '/doro/rindo.html': RIN, '/kanko/': NOPE, '/idx': '<html><body><a href="/bosai/">通行規制のご案内</a></body></html>', '/none': NOPE, '/sjis': SJIS}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        b = PAGES.get(self.path)
        if b is None: self.send_response(404); self.end_headers(); return
        b = b if isinstance(b, bytes) else b.encode('utf-8')
        self.send_response(200); self.send_header('Content-Type', 'text/html' if isinstance(PAGES[self.path], bytes) else 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(b)


srv = socketserver.TCPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
B = 'http://127.0.0.1:%d' % srv.server_address[1]
n = 0
def ok(c, m):
    global n; assert c, m; n += 1

st, url, info, note = mi.scan_one(B + '/top', sleep=0)
ok(st == 'found' and url.endswith('/doro/rindo.html'), (st, url, note))
ok(info['covers_forest_road'] is True and info['kind'] == 'html_table', info)
ok(info['updated_hint'].startswith('令和8年9月24日'), info)
st, url, info, note = mi.scan_one(B + '/idx', sleep=0)
ok(st is None or st == 'index_only', (st, note))          # 案内だけのページは found にしない
st, url, info, note = mi.scan_one(B + '/none', sleep=0)
ok(st is None and '見つからなかった' in note, note)          # 見つからないことは「無い」とは書かず、状態を作らない
st, url, info, note = mi.scan_one(B + '/missing', sleep=0)
ok(st is None and '開けなかった' in note, note)
# 文字コード(Shift_JIS)
_, html = mi.fetch(B + '/sjis'); ok('通行止め' in html, 'cp932')
# リンクの絞り込み: 外部サイトと PDF は辿らない
p = mi.parse('<a href="https://evil.example/通行止め">通行止め</a><a href="/a.pdf">通行止め</a><a href="/ok">通行止め情報</a>')
c = mi.candidates(B + '/', p, set()); ok([x[1] for x in c] == [B + '/ok'], c)
print('全 %d 件OK (muni_inventory.py)' % n)
