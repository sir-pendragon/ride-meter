# 群馬県の道路規制ページ(2026-10-14に確認した表の構造)の読み取りを確認する
import json
from playwright.sync_api import sync_playwright
R='/home/claude/ride-meter/'
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page();pg.set_content('<html></html>');pg.add_script_tag(path=R+'route/parse-road.js')
    h=open(R+'tests/data/gunma-list.html',encoding='utf-8').read()
    r=pg.evaluate("a=>ClosureRoad.parseGunma(new DOMParser().parseFromString(a,'text/html'),'https://x/y','2026-10-14T00:00:00Z',{today:new Date(Date.UTC(2026,9,14))}).map(r=>[r.route,r.section,r.typeText,r.status,r.period,r.officialUpdated,r.layer])",h)
    print(json.dumps(r,ensure_ascii=False))
    assert [x[0] for x in r]==['国道145号','南蛇井下仁田線','国道299号'], r
    assert all(x[3]=='不明' and x[6]=='road' and x[5]=='2026-10-14' for x in r)
    assert r[0][1]=='郷原交差点～岩島駅前交差点' and r[0][2]=='災害・大雨等: 土砂流出' and r[1][2]=='工事: 工事' and r[2][1]=='多野郡神流町平原～多野郡神流町平原'
    print('OK 群馬DOM');b.close()
