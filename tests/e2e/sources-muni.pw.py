import threading,http.server,socketserver,functools,time
from playwright.sync_api import sync_playwright
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(type('Q',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *a:None}),directory='/home/claude/ride-meter'));threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:%d/route/sources.html'%srv.server_address[1]);time.sleep(1)
    n=pg.evaluate("document.querySelectorAll('details.pf').length");assert n==7,n
    assert pg.evaluate("[...document.querySelectorAll('details.pf')].every(d=>!d.open)"),'最初は全部閉じている'
    assert pg.evaluate("document.querySelectorAll('details.pf table').length")==0,'閉じている間は表を作らない'
    cs=pg.evaluate("[...document.querySelectorAll('details.pf summary')].map(s=>s.textContent)");print(cs)
    assert all('確認済み' in c for c in cs),cs
    pg.click("details.pf:nth-of-type(7) summary");time.sleep(0.5)
    assert pg.evaluate("document.querySelectorAll('details.pf[open] table').length")==1
    t=pg.evaluate("document.querySelector('details.pf[open]').innerText");assert '相模原市' in t and '未確認' in t
    first=pg.evaluate("document.querySelector('details.pf[open] tbody tr td').textContent");print('先頭(確認済みが先):',first)
    assert pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),'横スクロールなし'
    assert not errs,errs;b.close()
print('OK')
