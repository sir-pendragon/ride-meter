# 「通行止めの確認」: 見つからなかったときの表示(通行規制なし / 判定できません / 未調査)
import threading,http.server,socketserver,functools,time
from playwright.sync_api import sync_playwright
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(type('Q',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *a:None}),directory='/home/claude/ride-meter/route'));threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':900});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.route('**/*',lambda r:r.continue_() if '127.0.0.1' in r.request.url else r.fulfill(status=204,body=''))
    pg.add_init_script("try{localStorage.setItem('rt-relay','https://relay.test')}catch(e){}")
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    def show(run,hits=[],warns=[]):
        return pg.evaluate("""([run,hits,warns])=>{Closures.lastRun=()=>run;Closures.hits=()=>hits;Closures.warnings=()=>warns;__rt.st.sel={pts:[[35.9,139.1],[35.91,139.11]]};__rt.renderClFound();return document.getElementById('cl-found').innerText}""",[run,hits,warns])
    t=show(None);print('未調査:',t.replace('\n',' / '));assert '未調査' in t and '通行規制なし' not in t.split('とは言えません')[0].replace('「通行規制なし」','')
    t=show({'fails':['甲府市: 失敗'],'unsupported':[]});print('失敗あり:',t.replace('\n',' / '));assert '判定できません' in t and '甲府市: 失敗' in t
    t=show({'fails':[],'unsupported':[]});print('なし:',t.replace('\n',' / '));assert t.startswith('通行規制なし') and '保証ではありません' in t
    t=show({'fails':[],'unsupported':[]},warns=[{'route':'X線','status':'通行止め','kind':'candidate','municipality':None,'section':None,'period':None,'sourceName':'S','sourceUrl':'https://example.com/'}]);print('あり:',t.replace('\n',' / '));assert 'X線' in t and '通行規制なし' not in t
    assert not errs,errs;b.close()
print('OK')
