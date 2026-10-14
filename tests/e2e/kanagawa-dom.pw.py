from pathlib import Path
# 神奈川県 県営林道ページ(2026-10-14に確認した構造)の読み取りを確認する
import json
from playwright.sync_api import sync_playwright
R=str(Path(__file__).resolve().parents[2]) + '/'
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page();pg.set_content('<html></html>');pg.add_script_tag(path=R+'route/parse-kanagawa.js')
    h=open(R+'tests/data/kanagawa-keneirin.html',encoding='utf-8').read()
    f="(a)=>ClosureKanagawa.parseKanagawa(new DOMParser().parseFromString(a.h,'text/html'),'https://x/y','2026-10-14T00:00:00Z',{today:new Date(Date.UTC(a.y,a.m,a.d))}).map(r=>[r.route,r.municipality,r.typeText,r.section,r.period,r.status,r.scope,r.bicycle,r.rid,r.officialUpdated,r.note])"
    r=pg.evaluate(f,{'h':h,'y':2026,'m':9,'d':14});print(json.dumps(r,ensure_ascii=False))
    assert len(r)==10, len(r)
    c=r[0]; assert c[:7]==['上秦野','秦野市三廻部','車両通行止め','全線','令和6年7月1日～令和9年3月31日','通行止め','whole'] and c[7] is None and '自転車' in c[10], c
    g={x[0]:x for x in r[1:]}
    assert g['本谷'][3]=='全線' and g['本谷'][6]=='whole' and '公安委員会規制: 7月1日～8月31日' in g['本谷'][10]
    assert g['境沢'][3]=='' and g['境沢'][6]=='unknown' and '養魚場付近' in g['境沢'][10] and '公安委員会規制' not in g['境沢'][10]
    assert all(x[9]=='2026-08-18' for x in r)
    r2=pg.evaluate(f,{'h':h,'y':2027,'m':3,'d':1}); assert len(r2)==9, len(r2)  # 期間終了(2027-04-01)後は文章の通行止めを除く
    print('OK 神奈川DOM');b.close()
