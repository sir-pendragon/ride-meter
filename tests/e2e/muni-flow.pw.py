# ルートが通る市町村の判定 → 台帳のリンク表示 / 取得先の絞り込み(通る市町村だけ取得)
import json,sys,time,threading,http.server,socketserver,functools
from playwright.sync_api import sync_playwright
ROOT='/home/claude/ride-meter'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
MUNI='MUNI_ARRAY["14151"] = \'14,神奈川県,ｻｶﾞﾐﾊﾗ,相模原市　緑区\';\nMUNI_ARRAY["14364"] = \'14,神奈川県,ﾔﾏｷﾀ,山北町\';\nMUNI_ARRAY["20202"] = \'20,長野県,ﾏﾂﾓﾄ,松本市\';\nMUNI_ARRAY["14201"] = \'14,神奈川県,ﾖｺｽｶ,横須賀市\';'
def scenario(points,codes_by_lat,expect_in,expect_not_in,relay_expect,relay_not):
    fetched=[];errs=[]
    with sync_playwright() as p:
        b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915})
        pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
        def h(route):
            u=route.request.url
            if 'muni.js' in u: return route.fulfill(status=200,headers={'access-control-allow-origin':'*','content-type':'application/javascript'},body=MUNI)
            if 'mreversegeocoder' in u:
                import urllib.parse as up
                la=float(up.parse_qs(up.urlparse(u).query)['lat'][0])
                cd=min(codes_by_lat,key=lambda t:abs(t[0]-la))[1]
                return route.fulfill(status=200,headers={'access-control-allow-origin':'*'},json={'results':{'muniCd':cd}})
            if 'relay.test' in u:
                fetched.append(u);return route.fulfill(status=404,headers={'access-control-allow-origin':'*','access-control-expose-headers':'*','x-upstream-status':'404'},body='')
            if 'overpass' in u: return route.fulfill(json={'elements':[]})
            if '127.0.0.1' in u: return route.continue_()
            return route.fulfill(status=204,body='')
        pg.route('**/*',h)
        pg.goto('http://127.0.0.1:%d/route/index.html'%srv.server_address[1]);time.sleep(0.5)
        pg.evaluate("""(pts)=>{localStorage.setItem('rt-relay','https://relay.test');__rt.st.points=pts}""",points)
        pg.reload();time.sleep(0.5)
        pg.evaluate("(pts)=>{__rt.st.points=pts}",points)
        pg.evaluate("document.querySelector('#ac-go').click()")
        for _ in range(60):
            time.sleep(0.5)
            if pg.evaluate("document.querySelector('#ac-munis').innerText.length")>0: break
        time.sleep(1.5)
        txt=pg.evaluate("document.querySelector('#ac-munis').innerText")
        hrefs=pg.evaluate("[...document.querySelectorAll('#ac-munis a')].map(a=>a.href)")
        b.close()
    for s in expect_in: assert s in txt,(s,txt)
    for s in expect_not_in: assert s not in txt,(s,txt)
    for s in relay_expect: assert any(s in f for f in fetched),(s,fetched)
    for s in relay_not: assert not any(s in f for f in fetched),(s,fetched)
    assert not errs,errs
    return txt,hrefs,fetched
# 1) 神奈川(相模原市緑区→山北町)を通る
t,hr,f=scenario([{'lat':35.60,'lon':139.20,'name':'S'},{'lat':35.30,'lon':139.00,'name':'G'}],[(35.60,'14151'),(35.30,'14364')],
  ['相模原市','山北町','公式ページ'],['松本市'],[],['matsumoto','azumino','ina'])
assert any('sagamihara' in h for h in hr),hr
assert any('yamakita' in h for h in hr),hr
print('OK 神奈川: 相模原市・山北町のリンクを表示',len(hr),'件')
# 2) 長野(松本市のみ)を通る: 松本市のページだけ取得し、安曇野市・伊那市は取得しない
t,hr,f=scenario([{'lat':36.23,'lon':137.97,'name':'S'},{'lat':36.20,'lon':137.95,'name':'G'}],[(36.23,'20202')],
  [],[],['city.matsumoto'],['city.azumino','inacity'])
print('OK 長野: 松本市のみ取得(取得URL',len(f),'件)')
# 3) 台帳に確認済みが無い市町村(横須賀市=未確認)
t,hr,f=scenario([{'lat':35.28,'lon':139.67,'name':'S'},{'lat':35.25,'lon':139.65,'name':'G'}],[(35.27,'14201')],
  ['横須賀市','確認できていない'],[],[],[])
print('OK 未確認の市町村は「確認できていない」と表示')
