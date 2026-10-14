"""通信回数の削減: 市町村の表・逆ジオコーダ・標高タイルを端末に保存し、2回目以降は通信しないことを確認する。"""
import json,time,threading,http.server,socketserver,os,functools,math,sys
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
STATIC={'on':False}
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
    def do_GET(self):
        if self.path.startswith('/data/muni-table.json'):
            if not STATIC['on']:self.send_response(404);self.end_headers();return
            t={str(10000+i).zfill(5):['テスト県','市%d'%i] for i in range(1100)};t['14151']=['神奈川県','相模原市　緑区']
            b=json.dumps({'t':t}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b);return
        return super().do_GET()
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
# routeはサイト直下の /route/ ではなく ROOT 直下で配信しているため、../data/ は /data/ に当たる
URL='http://127.0.0.1:%d/index.html'%srv.server_address[1]
MUNI='MUNI_ARRAY["14151"] = \'14,神奈川県,ｻｶﾞﾐﾊﾗ,相模原市　緑区\';\nMUNI_ARRAY["14364"] = \'14,神奈川県,ﾔﾏｷﾀ,山北町\';'
cnt={'muni':0,'rg':0,'dem':0}
n=0
def ok(c,m):
    global n;assert c,m;n+=1
def h(route):
    u=route.request.url
    if u.startswith('http://127.0.0.1'):return route.continue_()
    if 'maps.gsi.go.jp/js/muni.js' in u:cnt['muni']+=1;return route.fulfill(content_type='text/javascript',body=MUNI,headers={'access-control-allow-origin':'*'})
    if 'mreversegeocoder' in u:cnt['rg']+=1;return route.fulfill(json={'results':{'muniCd':'14151'}},headers={'access-control-allow-origin':'*'})
    if '/xyz/dem/' in u:cnt['dem']+=1;return route.fulfill(content_type='text/plain',body='\n'.join(','.join('100.0' for _ in range(256)) for _ in range(256)),headers={'access-control-allow-origin':'*'})
    return route.fulfill(status=204,body='')
def load(ctx):
    pg=ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.route('**/*',h)
    pg.goto(URL);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000);return pg,errs
with sync_playwright() as p:
    b=p.chromium.launch();ctx=b.new_context(viewport={'width':412,'height':915})
    # 1) 静的データなし: 国土地理院から1回だけ取り、端末に保存
    pg,errs=load(ctx)
    r=pg.evaluate("Promise.all([Closures.muniRaw(),Closures.muniRaw()]).then(a=>Object.keys(a[0]).length)")
    ok(r==2 and cnt['muni']==1,('同時に2回呼んでも取得は1回',cnt))
    pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    pg.evaluate("Closures.muniRaw()");ok(cnt['muni']==1,('再読み込み後は端末保存を使う',cnt))
    # 2) 逆ジオコーダ: 同じ地点は1回だけ。再読み込み後も保存された結果を使う
    pg.evaluate("Promise.all([Closures.revGeo(35.5,139.1),Closures.revGeo(35.6,139.2)]).then(()=>Closures.rgSave())");ok(cnt['rg']==2,cnt)
    pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    v=pg.evaluate("Closures.revGeo(35.5,139.1)");ok(v=='14151' and cnt['rg']==2,('保存済みの地点は通信しない',v,cnt))
    ok(pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('rt-rg'))).length")==2,'rt-rg に保存')
    # 3) 静的データ(1000件以上)があれば muni.js は取らない
    ctx2=b.new_context();STATIC['on']=True;before=cnt['muni']
    pg2,e2=load(ctx2);k=pg2.evaluate("Closures.muniRaw().then(t=>Object.keys(t).length)")
    ok(k==1101 and cnt['muni']==before,('静的データを使う',k,cnt));STATIC['on']=False
    # 4) 標高タイル: 2回目の計算は通信しない
    def tileRun(pg):
        pg.evaluate("__rt.st.points=[{lat:35.90,lon:139.08,name:'S'},{lat:35.90,lon:139.12,name:'G'}]")
        pg.evaluate("Object.keys(__rt).length")
        return pg.evaluate("(async()=>{const D=__rt.densify([[35.90,139.08],[35.90,139.12]],25);const z=await __rt.elevations(D);return z?z.length:0})()")
    pg3,e3=load(b.new_context());d0=cnt['dem'];a=tileRun(pg3);d1=cnt['dem']
    ok(a>0 and d1>d0,('1回目は標高タイルを取得',d0,d1))
    pg3.reload();pg3.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    a=tileRun(pg3);ok(a>0 and cnt['dem']==d1,('2回目(再読み込み後)は標高タイルを通信しない',d1,cnt['dem']))
    ok(errs==[] and e2==[] and e3==[],(errs,e2,e3))
    b.close()
print('全 %d 件OK (cache-flow)'%n)
