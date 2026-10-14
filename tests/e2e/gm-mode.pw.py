import json,threading,http.server,socketserver,functools
from playwright.sync_api import sync_playwright
ROOT=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'..','..','route')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
FAKE=open(''+__import__('os').path.join(__import__('os').path.dirname(__file__),'fake-google-maps.js')+'').read()
def run(key,fake=True):
    if True:
        p=sync_playwright().start()
        b=p.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915});errs=[];reqs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:d.accept())
        def h(route):
            u=route.request.url;reqs.append(u.split('?')[0])
            if 'maps.googleapis.com' in u:
                return route.fulfill(content_type='text/javascript',body=FAKE) if fake else route.abort()
            if u.startswith('http://127.0.0.1'):return route.continue_()
            return route.fulfill(status=200,content_type='text/plain',body='',headers={'access-control-allow-origin':'*'})
        pg.route('**/*',h)
        pg.add_init_script("try{localStorage.setItem('rt-gkey',%s)}catch(e){}"%json.dumps(key) if key else "0")
        pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]+'');pg.wait_for_timeout(1500)
        return pg,errs,reqs,b,p
# 1) Googleモード
pg,errs,reqs,b,p=run('AIzaTEST')
kind=pg.evaluate('window.__map.kind');st=pg.inner_text('#gk-st')
print('kind:',kind,'/',st)
print('Google script requested:',any('maps.googleapis.com' in r for r in reqs),' leaflet tiles requested:',any('cyberjapandata.gsi.go.jp/xyz/std' in r for r in reqs))
# 地図クリック → 吹き出し → 出発地
pg.evaluate('window.__fakeMap.click(35.7,139.5)');pg.wait_for_timeout(200)
iw=pg.evaluate('!!window.__lastIW && !!window.__lastIW.content && window.__lastIW.content.querySelector("[data-k=s]")!==null')
print('click→popup with 出発 button:',iw)
pg.evaluate('window.__lastIW.content.querySelector("[data-k=s]").click()');pg.wait_for_timeout(300)
pg.evaluate('window.__fakeMap.click(35.8,139.6)');pg.evaluate('window.__lastIW.content.querySelector("[data-k=g]").click()');pg.wait_for_timeout(300)
log=pg.evaluate('window.__glog')
print('markers created:',sum(1 for l in log if l[0]=='AME'),' draggable:',[l[1] for l in log if l[0]=='AME'])
mk=pg.evaluate('window.__mk.length')
# ドラッグ → 位置が更新される
pg.evaluate('(()=>{const m=window.__mk[0];m.position={lat:()=>35.71,lng:()=>139.51};m.fire("dragend")})()');pg.wait_for_timeout(300)
print('dragend handled, state saved:',pg.evaluate('JSON.parse(localStorage.getItem("rt-state")).points[0].lat'))
print('page errors:',errs)
b.close();p.stop()
# 2) キーなし → 従来のLeaflet/地理院
pg,errs,reqs,b,p=run('')
print('no key → kind:',pg.evaluate('window.__map.kind'),'/ gsi tiles:',any('cyberjapandata.gsi.go.jp/xyz/std' in r for r in reqs),'/ google requested:',any('maps.googleapis.com' in r for r in reqs),'/ errors:',errs)
b.close();p.stop()
# 3) キーあり・読み込み失敗 → 地理院に自動で戻る
pg,errs,reqs,b,p=run('AIzaBAD',fake=False)
pg.wait_for_timeout(1500)
print('google blocked → kind:',pg.evaluate('window.__map.kind'),'/',pg.inner_text('#gk-st'),'/ errors:',errs)
b.close();p.stop()
# 4) 図形API(Googleモード): 破線・吹き出し・ツールチップ・円・fitBounds
pg,errs,reqs,b,p=run('AIzaTEST')
print('L kind:',pg.evaluate('L._kind'))
res=pg.evaluate('''(()=>{
 const holder=L.map(document.createElement('div'));      // 新しい地図でAPIを一通り試す
 const g=L.layerGroup().addTo(holder);
 const pl=L.polyline([[35.9,139.0],[35.91,139.01],[35.92,139.02]],{color:'#C25A12',weight:6,opacity:.95,dashArray:'8 6'}).addTo(g).bindPopup('<b>テスト</b>').bindTooltip('案1');
 L.polyline([[35.9,139.0],[35.91,139.01]],{color:'#B3261E',weight:6}).addTo(g);
 L.circle([35.9,139.0],{radius:40}).addTo(g);
 const cm=L.circleMarker([35.9,139.0],{radius:7}).addTo(holder); cm.setLatLng([35.95,139.05]);
 const mk=L.marker([35.9,139.0],{icon:L.divIcon({html:'<div class=pin>S</div>'}),draggable:true}).addTo(g).bindTooltip('x');
 const b=L.polyline(pl.pts.map(p=>[p.lat,p.lng])).getBounds();
 holder.fitBounds(L.latLngBounds([[35.9,139],[35.95,139.05]]),{padding:[30,30],maxZoom:15});
 holder.setView([35.9,139.0],13);
 // クリック→吹き出し
 pl.g.fire('click',{latLng:{lat:()=>35.91,lng:()=>139.01}});
 const popped=!!window.__lastIW&&window.__lastIW.content.textContent==='テスト';
 pl.g.fire('mouseover',{latLng:{lat:()=>35.91,lng:()=>139.01}});
 const tip=window.__lastIW.content.textContent;
 g.clearLayers();
 const polys=window.__glog.filter(l=>l[0]==='Polyline');
 const unset=window.__glog.filter(l=>l[0]==='poly.setMap'&&l[1]===false).length;
 return {popped,tip,dashed:polys[0].slice(2),solid:polys[1].slice(2),center:b.getCenter(),unset,cmPos:cm.getLatLng(),zoom:holder.getZoom()}})()''')
print(json.dumps(res,ensure_ascii=False))
print('errors:',errs)
b.close();p.stop()
