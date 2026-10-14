"""共通探索(模擬サーバー): 全条件で、改善の余地があるときだけ追加探索。/route・/locate の回数、自転車通行可の確認、距離の上限。"""
import sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from _harness import *
# ---------- 7. 共通探索: 快適・絶景(景観の経由地)。確認 /locate は1回、追加 /route は3回以内、代替ルートは使わない ----------
BASE_LAT=35.9
def viaRoute(body):
    return [(l['lat'],l['lon']) for l in body['locations']]
CL=[{'type':'node','lat':35.9036+i*0.0003,'lon':139.1000+i*0.0003,'tags':{'tourism':'viewpoint'}} for i in range(3)]
def edgesQuiet(pts):return [{'length':plen(pts)/1000,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth','lane_count':1,'speed_limit':30}]
env=Env(route=viaRoute,edges=edgesQuiet,feat=CL)
r,pg,b=run(env,'cmf')
rec('快適・絶景(景観の経由地を追加)',env,r)
x=r['xlog'];print('explore cmf:',x,'routes',len(env.reqs))
ok(len(env.loc)==1 and x['locate']==1,'自動経由地の確認(/locate)は1回')
ok(1<len(env.reqs)<=4,('追加の /route は3回以内',len(env.reqs)))
ok(all(not q.get('alternates') for q in env.reqs[1:]),'追加探索では代替ルート(alternates)を使わない')
v=[q for q in env.reqs[1:] if len(q['locations'])>2];ok(v and all(l['type']=='through' for q in v for l in q['locations'][1:-1]) and all(q['locations'][0]['type']=='break' and q['locations'][-1]['type']=='break' for q in v),'経由地はthrough、スタートとゴールはbreak')
ok(all(abs(q['locations'][0]['lat']-S[0])<1e-9 and abs(q['locations'][-1]['lon']-G[1])<1e-9 for q in v),'利用者のスタート・ゴールは動かさない')
ok(any(c['auto'] for c in r['cands']),'追加探索の候補が加わる')
ok(r['cands'][r['sel']]['auto'] and r['cands'][r['sel']]['cmf']['V']>r['cands'][0]['cmf']['V'],'景観が改善した追加候補が選ばれる')
ok('追加探索の候補です' in r['text'] and '追加探索:' in r['text'],'追加探索の候補であることを表示')
ok(r['errs']==[],r['errs']);close(b)
# 自転車で通れると確認できない経由地は使わない
env=Env(route=viaRoute,edges=edgesQuiet,feat=CL,locate_ok=False)
r,pg,b=run(env,'cmf')
ok(len(env.reqs)==1 and r['xlog']['routes']==0 and not any(c['auto'] for c in r['cands']),('自転車で通れると確認できない経由地は使わず、追加の/routeもしない',len(env.reqs)))
ok('確認できなかったため使いません' in (r['xlog']['note'] or ''),r['xlog']);close(b)

# ---------- 8. 共通探索: 最大獲得標高(峠)。基本候補は上限なし、自動候補だけ最短の2倍まで ----------
PX=(35.9150,139.1000)
def hill(la,lo):
    d=math.hypot((la-PX[0])*111195,(lo-PX[1])*90110);return 200.0+250.0*max(0,1-d/2600)
PASS=[{'type':'node','lat':PX[0],'lon':PX[1],'tags':{'natural':'peak','ele':'450','name':'テスト峠'}}]
env=Env(route=viaRoute,edges=edgesQuiet,passes=PASS,elev=hill)
r,pg,b=run(env,'max')
rec('最大獲得標高(峠を追加)',env,r)
x=r['xlog'];print('explore max:',x,'gains',[c['gain'] for c in r['cands']])
ok(len(env.reqs)==2 and x['routes']==1 and len(env.loc)==1,('通常検索は1回+追加探索1回(最大獲得標高)',len(env.reqs)))
ok(r['cands'][r['sel']]['auto'] and r['cands'][r['sel']]['gain']>r['cands'][0]['gain']+50,'峠を経由した追加候補の獲得標高が大きく、選ばれる')
ok(r['cands'][r['sel']]['len']<=r['cands'][0]['len']*2.0+1,'自動の追加候補は、最短の2倍以内')
ok(env.reqs[0]['locations'].__len__()==2,'基本検索は2地点のみ')
close(b)
# 峠が遠すぎて2倍を超えるときは使わない
FAR=[{'type':'node','lat':35.9,'lon':139.1000,'tags':{'natural':'peak','ele':'900'}}]
PXf=(35.9400,139.1000)
env=Env(route=viaRoute,edges=edgesQuiet,passes=[{'type':'node','lat':PXf[0],'lon':PXf[1],'tags':{'natural':'peak','ele':'900'}}],elev=lambda la,lo:200.0)
r,pg,b=run(env,'max')
ok(len(env.reqs)==1 and not any(c['auto'] for c in r['cands']),('最短の2倍を超える見込みの峠は使わない',len(env.reqs)));close(b)
# 峠のデータがないときは、追加探索なし
env=Env(route=viaRoute,edges=edgesQuiet,passes=[])
r,pg,b=run(env,'max')
ok(len(env.reqs)==1 and len(env.loc)==0,'峠がなければ追加探索なし(通常検索1回のまま)');close(b)

# ---------- 9. 共通探索: 最小獲得標高(急坂に除外点)。除外点は利用者の地点の近くに置かない ----------
def ridge(la,lo):
    x=(lo-S[1])*90110
    if abs(la-35.9)<0.0010:
        if 1500<x<1900:return 200.0+(x-1500)*0.15
        if 1900<=x<2300:return 260.0-(x-1900)*0.15
    return 200.0
def dodge(body):
    ex=body.get('exclude_locations') or []
    hit=any(abs(e['lat']-35.9)<0.0012 and 139.0960<e['lon']<139.1040 for e in ex)
    if hit:return [S,(35.9040,139.0950),(35.9040,139.1050),G]
    return [(l['lat'],l['lon']) for l in body['locations']]
env=Env(route=dodge,edges=edgesQuiet,elev=ridge)
r,pg,b=run(env,'min')
rec('最小獲得標高(急坂に除外点)',env,r)
x=r['xlog'];print('explore min:',x,'gains',[c['gain'] for c in r['cands']])
ok(len(env.reqs)>=2 and x['routes']>=1,'急坂があるので、追加探索を行う')
ex=env.reqs[1].get('exclude_locations') or []
ok(any(abs(e['lat']-35.9)<0.0015 and 139.09<e['lon']<139.11 for e in ex),'急坂の位置に除外点を置く')
ok(all(hav((e['lat'],e['lon']),S)>300 and hav((e['lat'],e['lon']),G)>300 for e in ex[-3:]),'利用者の地点の近く(300m以内)には除外点を置かない')
ok(r['cands'][r['sel']]['gain']<r['cands'][0]['gain'],'急坂を避けた追加候補は獲得標高が小さく、最小獲得標高として選ばれる')
ok(len(env.loc)==0,'除外点は /locate で確認しない(Valhallaが道路に吸着するため)');close(b)
# 急坂がなければ追加探索なし
env=Env(route=direct,edges=edgesQuiet,elev=FLATZ)
r,pg,b=run(env,'min')
rec('最小獲得標高(改善余地なし)',env,r)
ok(len(env.reqs)==1 and r['xlog']['routes']==0,'改善の余地がなければ追加探索なし(通常検索 /route 1回のまま)');close(b)
# 追加探索の無効化(rt-explore=0)
env=Env(route=dodge,edges=edgesQuiet,elev=ridge)
b=PW.chromium.launch();pg=b.new_page();env.handler(pg)
pg.goto('http://127.0.0.1:%d/index.html'%srv.server_address[1]);pg.evaluate("localStorage.setItem('rt-explore','0')");pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000)
pg.select_option('#obj','min');pg.evaluate("__rt.st.points=[{lat:%f,lon:%f,k:'s'},{lat:%f,lon:%f,k:'g'}]"%(S+G));pg.click('#go');pg.wait_for_selector('#cards .card',timeout=30000);pg.wait_for_timeout(500)
ok(len(env.reqs)==1,'rt-explore=0 で追加探索を止められる');b.close()
# ---------- 13. 共通探索: 自転車ルート優先。まだ沿っていない長い自転車ルートの入口と出口を経由地にする ----------
CYW=[{'type':'way','geometry':[{'lat':35.9072,'lon':139.0900+i*0.0005} for i in range(0,37)]}]   # 北800mを東西に約1.6km
env=Env(route=viaRoute,edges=edgesQuiet,cyc=CYW)
r,pg,b=run(env,'cyc')
x=r['xlog'];print('explore cyc:',x,'routes',len(env.reqs))
rec('自転車ルート優先(自転車ルートの経由地を追加)',env,r)
ok(len(env.loc)==1 and 1<len(env.reqs)<=4,('確認 /locate は1回、追加の /route は3回以内',len(env.loc),len(env.reqs)))
v=[q for q in env.reqs[1:] if len(q['locations'])>2]
ok(v and len(v[0]['locations'])-2 in (2,4),('自転車ルートの入口と出口の2点(または2本分の4点)を経由地にする',[len(q['locations']) for q in env.reqs]))
lons=[l['lon'] for l in v[0]['locations']];ok(lons==sorted(lons),'経由地は、進む順(西から東)に並ぶ')
ok(r['cands'][r['sel']]['auto'],'自転車ルートに沿う追加候補が選ばれる')
close(b)

done('explore-flow')
