"""最小/最大獲得標高の選択 → 1本のルートだけ表示。候補は同時に問い合わせ、舗装率は選んだルートだけ調べる。"""
import json,time,threading,http.server,socketserver,os,functools,math
from playwright.sync_api import sync_playwright
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','route')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
def enc(pts):
    out='';pla=plo=0
    for la,lo in pts:
        a=round(la*1e6);b=round(lo*1e6)
        for d in (a-pla,b-plo):
            d=~(d<<1) if d<0 else d<<1
            while d>=0x20:
                out+=chr((0x20|(d&0x1f))+63);d>>=5
            out+=chr(d+63)
        pla,plo=a,b
    return out
S=(35.9000,139.0800);G=(35.9000,139.1200)
FLAT=[S,(35.9000,139.1000),G]                       # 平坦な道(直線)
HILL=[S,(35.9050,139.0900),(35.9050,139.1100),G]    # 丘を越える道(少し遠回り)
def elev(la,lo):                                     # 丘は緯度35.905付近の帯だけ
    if abs(la-35.905)<0.0025: return 200+80*math.sin((lo-139.08)/0.0025*math.pi)**2
    return 200.0
def tile(x,y):
    n=2**13;rows=[]
    for py in range(256):
        fy=y+(py+.5)/256;la=math.degrees(math.atan(math.sinh(math.pi*(1-2*fy/n))))
        row=[]
        for px in range(256):
            fx=x+(px+.5)/256;lo=fx/n*360-180
            row.append('%.1f'%elev(la,lo))
        rows.append(','.join(row))
    return '\n'.join(rows)
n=0
def ok(c,m):
    global n;assert c,m;n+=1
routes=[];tr=[];OV={'mode':'hill','n':0}
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
    def h(route):
        u=route.request.url
        if u.startswith('http://127.0.0.1'):return route.continue_()
        if 'valhalla' in u and u.endswith('/route'):
            body=json.loads(route.request.post_data);v=body['costing_options']['bicycle'];routes.append(v)
            pts=HILL if v['use_hills']>=1 else FLAT
            j={'trip':{'legs':[{'shape':enc(pts)}]}}
            if body.get('alternates'):j['alternates']=[{'trip':{'legs':[{'shape':enc(FLAT if pts is HILL else HILL)}]}}]
            return route.fulfill(json=j)
        if 'valhalla' in u and 'trace_attributes' in u:
            tr.append(1);return route.fulfill(json={'edges':[{'surface':'paved_smooth','length':3}]})
        if 'overpass' in u:
            OV['n']+=1
            if OV['mode']=='fail':return route.fulfill(status=500,body='err')
            way=HILL if OV['mode']=='hill' else FLAT
            return route.fulfill(json={'elements':[{'type':'way','geometry':[{'lat':la,'lon':lo} for la,lo in way]}]},headers={'access-control-allow-origin':'*'})
        if 'mreversegeocoder' in u:return route.fulfill(json={'results':{'muniCd':'11201'}})
        if '/xyz/dem/' in u:
            parts=u.split('/dem/13/')[1].replace('.txt','').split('/');return route.fulfill(content_type='text/plain',body=tile(int(parts[0]),int(parts[1])))
        return route.fulfill(status=204,body='')
    pg.route('**/*',h)
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    ok(pg.inner_text('#go')=='ルートを計算','ボタン名')
    ok(pg.evaluate("[...document.querySelectorAll('#obj option')].map(o=>o.textContent)")==['最小獲得標高','最大獲得標高','自転車ルートを優先','快適・絶景'],'プルダウンの選択肢(既存の3つ+快適・絶景)')
    pg.evaluate("__rt.st.points=[{lat:%f,lon:%f,name:'S'},{lat:%f,lon:%f,name:'G'}]"%(S+G))
    def run(obj):
        routes.clear();tr.clear()
        pg.select_option('#obj',obj);pg.wait_for_timeout(100)
        pg.evaluate("__rt.st.points=[{lat:%f,lon:%f,name:'S'},{lat:%f,lon:%f,name:'G'}]"%(S+G))
        t=time.time();pg.click('#go');pg.wait_for_selector('#cards .card',timeout=30000);pg.wait_for_function('document.querySelector("#cards .stats")',timeout=30000);pg.wait_for_timeout(600)
        return time.time()-t
    t1=run('min')
    ok(len(routes)==1 and routes[0]['use_hills']==0,('最小は坂を避ける1回の問い合わせ',routes))
    r=pg.evaluate("({cards:document.querySelectorAll('#cards .card').length,title:document.querySelector('#cards .t').textContent,sel:__rt.st.sel&&__rt.st.sel.gain,cands:__rt.st.cands.map(c=>c.gain),pav:document.querySelector('#cards .stats').textContent})")
    print('min:',r,'trace_attributes calls:',len(tr),'time %.1fs'%t1)
    ok(r['cards']==1 and '最小獲得標高' in r['title'],r)
    ok(r['sel']==min(c for c in r['cands'] if c is not None),r)
    ok(len(tr)==1,('舗装率は選んだルートだけ調べる',len(tr)))
    ok('100%' in r['pav'],r['pav'])
    t2=run('max')
    ok(len(routes)==1 and routes[0]['use_hills']==1,('最大は坂を好む1回の問い合わせ',routes))
    r2=pg.evaluate("({cards:document.querySelectorAll('#cards .card').length,title:document.querySelector('#cards .t').textContent,sel:__rt.st.sel.gain,cands:__rt.st.cands.map(c=>c.gain),tb:!!document.getElementById('tb'),notes:!!document.getElementById('notes')})")
    print('max:',r2,'time %.1fs'%t2)
    ok(r2['cards']==1 and '最大獲得標高' in r2['title'],r2)
    ok(r2['sel']==max(c for c in r2['cands'] if c is not None) and r2['sel']>r['sel'],r2)
    ok(not r2['tb'] and not r2['notes'],'候補の表と注意書きは出さない(ルートは1本)')
    # 自転車ルートを優先: 登録された自転車ルートに沿う候補を選ぶ。取得に失敗したら警告を出す
    t3=run('cyc')
    ok(len(routes)==1 and routes[0]['use_roads']==0.1,('自転車ルートは車道を避ける1回の問い合わせ',routes))
    r3=pg.evaluate("({title:document.querySelector('#cards .t').textContent,cyc:__rt.st.cands.map(c=>c.cyc),sel:__rt.st.sel.cyc,gain:__rt.st.sel.gain,txt:document.querySelector('#cards').textContent})")
    print('cyc:',r3)
    ok('自転車ルート優先' in r3['title'] and r3['sel']==max(r3['cyc']) and r3['sel']>0.9,r3)
    ok(r3['gain']>0,'登録ルート(丘越え)の候補が選ばれる')
    ok('登録済み自転車ルート沿い' in r3['txt'] and '実際に走られている量ではありません' in r3['txt'],'割合と注意書き')
    n_ov=OV['n'];run('cyc');ok(OV['n']==n_ov,'同じ範囲の2回目はOSMに問い合わせない(端末に保存)')
    pg.evaluate("caches.delete('rt-cyc')");OV['mode']='fail'
    run('cyc');r4=pg.evaluate("document.querySelector('#cards').textContent")
    ok('自転車ルートのデータを取得できませんでした' in r4 and '登録済み自転車ルート沿い' not in r4,r4)
    # 目的を変えたら結果を消す(候補の作り方が違うため)
    pg.select_option('#obj','min');pg.wait_for_timeout(200)
    ok(pg.evaluate("document.getElementById('s-res').hidden"),'目的を変えたら結果を消す')
    # 保存
    pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
    ok(pg.input_value('#obj')=='min','選択が保存される')
    ok(errs==[],errs)
    b.close()
print('全 %d 件OK (objective-flow)'%n)
