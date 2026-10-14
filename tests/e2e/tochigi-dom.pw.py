from pathlib import Path
# 栃木県 矢板森林管理事務所の表(2026-10-14に確認した列名・文面)の読み取りを確認する
import json
from playwright.sync_api import sync_playwright
R=str(Path(__file__).resolve().parents[2]) + '/'
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page();pg.set_content('<html></html>');pg.add_script_tag(path=R+'route/parse-tables.js')
    h=open(R+'tests/data/tochigi-yaita.html',encoding='utf-8').read()
    r=pg.evaluate("h=>ClosureParse.parseClosureTables(new DOMParser().parseFromString(h,'text/html'),'https://x/y','2026-10-14T00:00:00Z',{closedTable:true,brSep:true}).map(r=>[r.route,r.municipality,r.section,r.status,r.scope,r.period,r.note,r.officialUpdated,r.bicycle])",h)
    print(json.dumps(r,ensure_ascii=False))
    assert len(r)==3
    assert r[0][:5]==['天上沢線','塩谷町上寺島','全区間／一般車両には開放していません。','通行止め','whole'] and r[0][5] is None
    assert '措置: 関係車両以外通行不可／起点側:鋼製ゲートを設置' in r[0][6]
    assert r[1][3]=='通行止め' and r[1][4]=='unknown' and r[1][2].startswith('起点～精進橋')
    assert '対策工事が完了' in r[2][5]
    assert r[0][7]=='2025-12-04' and r[0][8] is None
    print('OK 栃木DOM');b.close()
