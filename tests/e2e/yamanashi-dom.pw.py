from pathlib import Path
# 山梨県の実ページの構造(2026-10-14にブラウザで確認したHTML)で、一覧・詳細の読み取りを確認する
import json,sys
from playwright.sync_api import sync_playwright
R=str(Path(__file__).resolve().parents[2]) + '/'
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page();pg.set_content('<html></html>');pg.add_script_tag(path=R+'route/parse-yamanashi.js')
    lst=open(R+'tests/data/yamanashi-list.html',encoding='utf-8').read();det=open(R+'tests/data/yamanashi-detail-90.html',encoding='utf-8').read()
    L=pg.evaluate("h=>ClosureYamanashi.parseList(new DOMParser().parseFromString(h,'text/html'),'https://www.pref.yamanashi.jp/rindoujyouhou/list.php').map(x=>[x.name,x.mgmt,x.kisei,x.yotei,x.url.slice(-6)])",lst)
    D=pg.evaluate("h=>ClosureYamanashi.parseDetail(new DOMParser().parseFromString(h,'text/html'),'https://www.pref.yamanashi.jp/rindoujyouhou/kisei.php?id=90','2026-10-14T00:00:00Z',{today:new Date(Date.UTC(2026,9,14))}).map(r=>[r.route,r.municipality,r.typeText,r.status,r.scope,r.section,r.rid])",det)
    print(json.dumps(L,ensure_ascii=False));print(json.dumps(D,ensure_ascii=False))
    assert len(L)==4 and L[1][3] and not L[1][2] and L[2][1]=='山梨市営' and L[3][2], L
    assert len(D)==2 and D[0][0]=='井川雨畑線' and D[0][1]=='早川町雨畑(山梨県) → 県境:山伏峠(山梨県)' and D[0][2]=='工事による規制' and D[1][2]=='その他による規制' and D[1][3]=='通行止め' and D[1][5]=='' and D[0][6]!=D[1][6], D
    print('OK 山梨DOM');b.close()
