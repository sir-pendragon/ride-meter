import json,sys,time,threading,http.server,socketserver,os,functools,re
from playwright.sync_api import sync_playwright
ROOT='/home/claude/ride-meter/route'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
H=functools.partial(Q,directory=ROOT)
srv=socketserver.TCPServer(('127.0.0.1',0),H);srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
def enc(pts):
    out='';pl=pla=0;plo=0
    for la,lo in pts:
        a=round(la*1e6);b=round(lo*1e6)
        for d in (a-pla,b-plo):
            d=~(d<<1) if d<0 else d<<1
            while d>=0x20:
                out+=chr((0x20|(d&0x1f))+63);d>>=5
            out+=chr(d+63)
        pla,plo=a,b
    return out
# 閉鎖する道(広河原線)と、ルートA(閉鎖を通る)・ルートB(迂回)
CLOSED=[(35.9000,139.0900),(35.9010,139.0950),(35.9020,139.1000),(35.9030,139.1050)]
ROUTE_A=[(35.8990,139.0850),*CLOSED,(35.9040,139.1100)]
ROUTE_B=[(35.8990,139.0850),(35.8900,139.0950),(35.8900,139.1050),(35.9040,139.1100)]
HTML='''<html><body><p>掲載日：2026年10月1日</p><table><tr><th>路線名</th><th>通行制限の種類</th><th>通行制限区間(位置)</th><th>通行制限の期間</th><th>通行制限事由</th></tr>
<tr><td>広河原線</td><td>全面通行止め</td><td>全線(秩父市浦山地内)</td><td>当面の間</td><td>落石多発のため</td></tr>
<tr><td>長久保線</td><td>一部区間通行止め</td><td>起点より3.5km~終点</td><td>当面の間</td><td>崩落</td></tr></table></body></html>'''
LIST='<html><body><table class="rindoTb2"><tbody><tr><th>林道名</th><th>管理区分</th><th>交通規制</th></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=100">ダミー0【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=101">ダミー1【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=102">ダミー2【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=103">ダミー3【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=104">ダミー4【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=105">ダミー5【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=106">ダミー6【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=107">ダミー7【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=108">ダミー8【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=109">ダミー9【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=110">ダミー10【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=111">ダミー11【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=112">ダミー12【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=113">ダミー13【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=114">ダミー14【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=115">ダミー15【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=116">ダミー16【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=117">ダミー17【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=118">ダミー18【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=119">ダミー19【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=120">ダミー20【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=121">ダミー21【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=122">ダミー22【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=123">ダミー23【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=124">ダミー24【ﾀﾞﾐ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=70">嵯峨塩深沢【ｻｶﾞｼｵﾌｶｻﾜ】線</a></td><td>県営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="kisei">規制中</td></tr><tr><td><a href="https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=65">鈴庫山【ｽｽﾞｸﾗﾔﾏ】線</a></td><td>山梨市営</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="kisei">規制中</td></tr></tbody></table></body></html>'
DET='<html><body><h1>県営林道嵯峨塩深沢【ｻｶﾞｼｵﾌｶｻﾜ】線</h1><table class="rindoTb"><tbody><tr><th>起点</th><td>甲州市勝沼町大字深沢</td><th>終点</th><td>甲州市塩山大字牛奥</td></tr></tbody></table><table class="rindoTb"><tbody><tr><th>冬期閉鎖</th><th>気象状況</th><th>工事</th><th>その他</th></tr><tr><td class="blank">─</td><td class="blank">─</td><td class="blank">─</td><td class="kisei">&lt; 全 線 &gt; 法面崩落のため、全線通行を規制します。<br></td></tr></tbody></table></body></html>'
def run(honor):
    reqs=[]
    with sync_playwright() as p:
        b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
        def h(route):
            u=route.request.url
            if 'relay.test' in u:
                return route.fulfill(status=200,headers={'content-type':'text/html','access-control-allow-origin':'*','x-fetched-at':'2026-10-14T00:00:00Z','x-upstream-status':'200','access-control-expose-headers':'*'},body=(DET if 'id%3D70' in u or 'id=70' in u else LIST if 'yamanashi' in u else HTML))
            if 'mreversegeocoder' in u:
                return route.fulfill(json={'results':{'muniCd':'19201'}})
            if 'overpass' in u:
                els=[{'type':'way','id':1,'tags':{'name':'林道嵯峨塩深沢線','highway':'track'},'geometry':[{'lat':a,'lon':o} for a,o in CLOSED]},{'type':'way','id':2,'tags':{'name':'林道ダミー1線','highway':'track'},'geometry':[{'lat':35.95,'lon':139.2},{'lat':35.96,'lon':139.21}]}]
                return route.fulfill(json={'elements':els})
            if 'valhalla' in u and u.endswith('/route'):
                body=json.loads(route.request.post_data);reqs.append(body)
                ex=body.get('exclude_locations') or []
                avoid=honor and any(abs(e['lat']-c[0])<0.002 and abs(e['lon']-c[1])<0.002 for e in ex for c in CLOSED)
                pts=ROUTE_B if avoid else ROUTE_A
                return route.fulfill(json={'trip':{'legs':[{'shape':enc(pts)}],'summary':{'length':3}}})
            if 'valhalla' in u and 'trace_attributes' in u: return route.fulfill(json={'edges':[{'surface':'paved_smooth','length':3}]})
            if 'valhalla' in u: return route.fulfill(status=400,json={'error':'x'})
            if 'cyberjapandata' in u and '/dem/' in u: return route.fulfill(headers={'access-control-allow-origin':'*'},body='\n'.join(','.join(str(100+i//4) for i in range(256)) for _ in range(256)))
            if 'cyberjapandata' in u: return route.fulfill(status=404,body='')
            if 'nominatim' in u: return route.fulfill(json=[])
            if '127.0.0.1' in u: return route.continue_()
            return route.fulfill(status=204,body='')
        pg.route('**/*',h)
        pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function("typeof __rt!==\"undefined\"",timeout=20000)
        pg.evaluate("""()=>{localStorage.setItem('rt-relay','https://relay.test');localStorage.removeItem('rt-confirmed');
          __rt.st.points=[{lat:35.8990,lon:139.0850,name:'S'},{lat:35.9040,lon:139.1100,name:'G'}]}""")
        pg.reload();pg.wait_for_function("typeof __rt!==\"undefined\"",timeout=20000)
        pg.evaluate("()=>{__rt.st.points=[{lat:35.8990,lon:139.0850,name:'S'},{lat:35.9040,lon:139.1100,name:'G'}]}")
        pg.evaluate('__rt.compute()');pg.wait_for_selector('#ac-list button[data-a=avoid]',timeout=30000);pg.wait_for_selector('#cards .card',timeout=30000);time.sleep(0.5)
        print('AUTO fetched without button; relay hits:',sum(1 for _ in [0]))
        print('status:',pg.inner_text('#ac-st')[:300])
        print('GAP:',pg.inner_text('#ac-gap').replace('\n',' / ')[:700]);print('NOTE:',pg.inner_text('#gap-note')[:300])
        print('list:',pg.inner_text('#ac-list').replace('\n',' / ')[:600])
        cf=pg.inner_text('#cl-found');print('通行止めの確認(避ける前):',cf.replace('\n',' / ')[:200]);assert '嵯峨塩' in cf and ('位置は推定' in cf or '区間を特定' in cf),cf
        pg.click('#ac-list button[data-a=avoid]');time.sleep(0.5)
        print('confirmed:',pg.inner_text('#ac-conf').replace('\n',' / ')[:200])
        n0=len(reqs)
        pg.evaluate("__rt.compute()");pg.wait_for_selector('#cards .card',timeout=30000);time.sleep(1)
        print('route requests:',len(reqs)-n0)
        exs=[len(r.get('exclude_locations') or []) for r in reqs[n0:]]
        print('exclude counts per request:',sorted(set(exs)))
        print('cards warn:',pg.evaluate("[...document.querySelectorAll('#cards .warn')].map(e=>e.textContent)"))
        print('status line:',pg.inner_text('#st')[:200])
        print('通行止めの確認:',pg.inner_text('#cl-found').replace('\n',' / ')[:400])
        assert pg.evaluate("!document.querySelector('#s-cl a')"),'外部リンクは出さない'
        print('errors:',errs);b.close()
for honor in (True,False):
    print('=== 除外を守るサーバー' if honor else '=== 除外を無視するサーバー');run(honor)
