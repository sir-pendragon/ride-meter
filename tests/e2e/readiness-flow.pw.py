"""Mock API failure recovery, one-attempt requests, and exported GPX."""
import json, sys, time, pathlib, xml.etree.ElementTree as ET
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from _harness import *

for status in (429,503,504):
    env=Env(direct,edges=edgesOf())
    b=PW.chromium.launch();pg=b.new_page();env.handler(pg)
    requests=[]
    def failure(r):
        requests.append(r.request.url);return r.fulfill(status=status,json={'error':'temporarily unavailable'})
    pg.route('**/valhalla1.openstreetmap.de/route',failure)
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"')
    pg.evaluate("__rt.st.points=[{lat:35.9,lon:139.08,k:'s'},{lat:35.9,lon:139.12,k:'g'}]")
    pg.click('#go');pg.wait_for_function('!document.querySelector("#go").disabled')
    ok(len(requests)==1,('失敗した/routeの再試行なし',status,requests))
    ok('計算できませんでした' in pg.inner_text('#st'),'失敗理由を表示する');b.close()

for mode in ('max','cyc'):
    env=Env(direct,edges=edgesOf())
    b=PW.chromium.launch();pg=b.new_page();env.handler(pg)
    pg.add_init_script('window.__rtOvpMs=300;')
    # AbortSignalでキャンセルされるまで応答を保留する模擬通信。
    pg.route('**/*overpass*/**',lambda r:None)
    pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.wait_for_function('typeof __rt!=="undefined"')
    pg.select_option('#obj',mode);pg.evaluate("__rt.st.points=[{lat:35.9,lon:139.08,k:'s'},{lat:35.9,lon:139.12,k:'g'}]")
    start=time.monotonic();pg.click('#go');pg.wait_for_selector('#cards .card')
    ok(time.monotonic()-start<5,('Overpass無応答でも基本ルートを返す',mode))
    ok(len(env.reqs)==1 and pg.evaluate('!!__rt.st.sel'),'無応答で追加探索をしない')
    txt=pg.inner_text('#cards')
    ok('取得できませんでした' in txt,('利用者へ取得失敗を表示する',mode,txt))
    pg.unroute_all(behavior='ignoreErrors');b.close()

env=Env(direct,edges=edgesOf())
r,pg,b=run(env,'cmf')
with pg.expect_download() as waiting:pg.click('#gpx')
download=waiting.value
gpx=ET.parse(download.path()).getroot()
ns={'g':'http://www.topografix.com/GPX/1/1'}
track=gpx.findall('.//g:trkpt',ns)
ok(len(track)>100,'GPXに標高評価用のルート点が書き出される')
ok(abs(float(track[0].attrib['lat'])-S[0])<1e-6 and abs(float(track[-1].attrib['lon'])-G[1])<1e-6,'GPXの出発地・目的地を維持する')
ok(all(t.find('g:ele',ns) is not None for t in track),'GPX標高を維持する');b.close()
done('readiness-flow')
