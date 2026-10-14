from pathlib import Path
# 松本市・安曇野市・甲府市・伊那市の実ページ(2026-10-14に確認した構造・文面)の読み取りを確認する
import json
from playwright.sync_api import sync_playwright
R=str(Path(__file__).resolve().parents[2]) + '/'
def rd(n): return open(R+'tests/data/'+n,encoding='utf-8').read()
with sync_playwright() as p:
    b=p.chromium.launch();pg=b.new_page();pg.set_content('<html></html>');pg.add_script_tag(path=R+'route/parse-city.js')
    def run(fn,h,y=2026,m=9,d=14):
        return pg.evaluate("(a)=>ClosureCity."+fn+"(new DOMParser().parseFromString(a.h,'text/html'),'https://x/y','2026-10-14T00:00:00Z',{today:new Date(Date.UTC(a.y,a.m,a.d))}).map(r=>[r.route,r.municipality,r.typeText,r.section,r.period,r.status,r.scope,r.bicycle,r.officialUpdated,r.note])",{'h':h,'y':y,'m':m,'d':d})
    mt=run('parseMatsumoto',rd('matsumoto-rindo.html')); print(json.dumps(mt,ensure_ascii=False))
    names=[(x[0],x[3],x[5],x[6]) for x in mt]
    assert names==[('美ヶ原線','美鈴湖～武石峠','一部規制','partial'),('宮ノ入線','中山～高遠線分岐(頂上)','通行止め','partial'),('宮ノ入線','入山辺～高遠線分岐(頂上)','一部規制','partial'),('高遠線','','通行止め','unknown'),('奈川安曇線','Ａ区間 (奈川温泉～乗鞍高原)','一部規制','partial'),('奈川安曇線','Ｃ区間 (白骨温泉～安房峠)','通行止め','partial')],names
    assert all(x[1]=='松本市' and x[7] is None and x[8]=='2026-10-09' for x in mt)
    assert '区間の記載なし' in mt[3][9]
    # 予告(よもぎこば線)は10/19から: 10/14時点では除く。10/20なら予告ではなく開始後でも「予告」の文言のため除く(現行の保守的な扱い)
    ms=run('parseMatsumoto',rd('matsumoto-rindo.html'),2026,10,1); assert not any(x[0]=='奈川安曇線' and x[3].startswith('Ａ') for x in ms), '期間終了(10月下旬の後)なら除く'
    az=run('parseAzumino',rd('azumino-rindo.html')); print(json.dumps(az,ensure_ascii=False))
    assert [(x[0],x[5]) for x in az]==[('一の沢線','通行止め'),('烏川線','一部規制')] and az[0][3]=='入口ゲート(長野県烏川渓谷緑地 森林学習棟駐車場西)から' and '歩行者も通行できない' in az[1][9]
    assert len(run('parseAzumino',rd('azumino-rindo.html'),2026,9,13))==1, '烏川線は10/14開始: 前日は除く'
    kf=run('parseKofu',rd('kofu-rindo.html')); print(json.dumps(kf,ensure_ascii=False))
    assert [(x[0],x[3].replace('~','～'),x[5],x[6]) for x in kf]==[('御岳','金峰山表参道駐車場～終点','通行止め','partial'),('木賊','全線','通行止め','whole'),('奥仙丈','全線','通行止め','whole'),('王岳','全線','通行止め','whole')] and '解除されている可能性' in kf[1][9] and kf[0][8]=='2026-09-18'
    link=pg.evaluate("h=>ClosureCity.findKofuLink(new DOMParser().parseFromString(h,'text/html'),'https://www.city.kofu.yamanashi.jp/machi/kotsu/index.html')",rd('kofu-index.html'))
    assert link=='https://www.city.kofu.yamanashi.jp/shinrin/rindou/taifu.html',link
    ina=run('parseIna',rd('ina-minamialps.html')); print(json.dumps(ina,ensure_ascii=False))
    assert len(ina)==1 and ina[0][0]=='南アルプス林道' and ina[0][5]=='通行止め' and ina[0][6]=='whole' and '冬季閉鎖' not in ina[0][9] and ina[0][7] is None
    ina2=run('parseIna',rd('ina-minamialps.html'),2026,11,5); assert '冬季閉鎖' in ina2[0][9]
    print('OK 市DOM');b.close()
