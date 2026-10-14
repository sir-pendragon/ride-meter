"""快適・絶景モード(模擬サーバー): 採点・補正・除外・距離の上限・通行可否・復元。"""
import sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from _harness import *
import _harness as H
# ---------- 1. 通常の快適・絶景: 基本検索1回・属性は候補ごと1回・Overpass1回。静かで景観のよい遠回りを選ぶ ----------
VP=[{'type':'node','lat':35.9072+i*0.0004,'lon':139.1000+i*0.0004,'tags':{'tourism':'viewpoint'}} for i in range(3)]
def edges1(pts):
    busy=max(la for la,lo in pts)<35.901   # 直線ルート=国道、北回り=自転車道
    return [{'length':plen(pts)/1000,'road_class':'primary' if busy else 'residential','use':'road' if busy else 'cycleway','travel_mode':'bicycle','surface':'paved_smooth','lane_count':2 if busy else 1,'speed_limit':50 if busy else 20}]
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
rec('快適・絶景(通常・改善余地なし)',env,r)
print('cmf basic:',[(c['cmf']['Q'],c['cmf']['H'],c['cmf']['V'],c['cmf']['S']) for c in r['cands']],'sel',r['sel'],'routes',len(env.reqs),'trace',len(env.tr),'ov',len(env.ov),'loc',len(env.loc),'xlog',r['xlog'])
ok(len(r['cands'])==2,'候補は直線ルートと遠回りの2本')
ok(r['cands'][0]['cmf']['Q']<r['cands'][1]['cmf']['Q'],'国道は静かさが低く、自転車道は高い')
ok(r['cands'][1]['cmf']['V']>r['cands'][0]['cmf']['V'],'展望地の近くを通る候補は景観が高い')
ok(r['sel']==1 and r['best']==1,'総合スコアの高い、静かで景観のよい遠回りを選ぶ')
ok(r['cands'][1]['len']<r['cands'][0]['len']*1.5,'遠回りは最短の1.5倍以内')
ok(len(env.reqs)>=1 and env.reqs[0]['costing_options']['bicycle']['use_hills']==0.1 and env.reqs[0]['costing_options']['bicycle']['use_roads']==0.1,'基本検索は /route 1回(坂と車道を避ける設定)')
ok(len(env.tr)==2,('属性は候補ごとに1回(2回)',len(env.tr)))
ok(len(env.ov)==1 and 'viewpoint' in env.ov[0] and 'natural"="coastline' in urllib.parse.unquote_plus(env.ov[0]),'景観のOverpassは1回')
for t in env.tr:ok(len(t)>=2,'属性の問い合わせはルートの形状から作り直す')
ok('快適スコア' in r['text'] and '静かさ(推定)' in r['text'] and '激坂の少なさ' in r['text'] and '景観(推定)' in r['text'],'内訳を表示')
ok('実測ではありません' in r['text'] and '最適解を保証するものではありません' in r['text'],'推定・最適解を保証しない旨の注記')
ok('森林・山並みは評価していません' in r['text'],'森林・山並みは対象外と明記')
ok('距離上限' not in r['text'] and not pg.evaluate("!!document.querySelector('input[placeholder*=\"距離\"]')"),'距離上限の入力欄は追加していない')
ok(r['errs']==[],r['errs']);close(b)

# ---------- 2. 距離の上限(最短の1.5倍)と通行止め回避の優先 ----------
farN=lambda body:[S,(35.9300,139.1000),G]   # 約2.3倍の大回り
env=Env(route=direct,alt=farN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
ok(r['cands'][1]['cmf']['ex']=='距離' and r['sel']!=1 and r['cands'][r['sel']]['len']<=r['cands'][0]['len']*1.5+1,('1.5倍を超える候補は、スコアに関係なく除外(選ばれた候補は1.5倍以内)',r['sel']))
close(b)
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
sel0=r['sel']
pg.evaluate("__rt.st.cands[%d].hitsAuto=[{route:'テスト線'}];__rt.choose()"%sel0)
ok(pg.evaluate("__rt.st.cands.indexOf(__rt.st.sel)")!=sel0,'通行止めに当たる候補は、スコアが最高でも選ばない')
pg.evaluate("__rt.st.cands.forEach(c=>c.hitsAuto=[{route:'テスト線'}]);__rt.choose()")
ok(pg.evaluate("__rt.st.sel!=null"),'すべて当たるときは、警告つきで選ぶ(選べないままにしない)')
close(b)
# 通行止めを避けるために長くなった場合は、理由を表示する(通常は表示しない)
env=Env(route=lambda body:[S,(35.9072,139.1000),G],edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
ok('1.5倍を超えています' not in r['text'],'通常は超過の表示なし')
pg.evaluate("__rt.compute._len0=__rt.st.sel.len/1.8;__rt.render(true)")
t=pg.evaluate("document.querySelector('#cards').textContent")
ok('通行止めを避けるため、最短(' in t and '1.5倍を超えています' in t and '通行止めの回避を優先しました' in t,'通行止め回避で1.5倍を超えたときは、理由を表示する');close(b)

# ---------- 3. 通行可否: 押し歩き・階段は静かさに数えない ----------
def edges3(pts):
    L=plen(pts)/1000
    return [{'length':L*0.5,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth'},{'length':L*0.25,'road_class':'residential','use':'steps','travel_mode':'pedestrian','surface':'paved'},{'length':L*0.25,'surface':'paved'}]
env=Env(route=direct,edges=edges3)
r,pg,b=run(env,'cmf')
c=r['cands'][0]['cmf']
ok(abs(c['unk']-0.5)<0.02 and c['walkM']>800,('押し歩き(階段)と通行可否が不明な区間を、静かさに数えない',c))
ok(abs(c['Q']-(1-(0.5*0.2+0.5*0.5))) <0.02,('不明は中立(0.5)',c['Q']))
ok('自転車で走れない可能性のある区間' in r['text'],'押し歩き区間の警告を表示')
close(b)

# ---------- 4. 属性が取れない/景観が取れないとき: 断定しない ----------
env=Env(route=direct,alt=detourN,edges=None,feat=VP)
r,pg,b=run(env,'cmf')
ok(all(c['cmf'].get('Q') is None for c in r['cands'] if c['cmf']),'属性が取れなければ静かさは評価しない(0や1にしない)')
ok('静かさは、道路の属性を取得できなかったため評価していません' in r['text'] or '属性を取得できなかった' in r['text'],'属性が取れなかった旨を表示')
ok(r['sel']>=0 and r['sel']<len(r['cands']),'それでも結果は出る');close(b)
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP,ov_fail=True)
r,pg,b=run(env,'cmf')
ok('景観のデータを取得できませんでした' in r['text'] and '景観は、データを取得できなかったため評価していません' in r['text'],'景観が取れなければ、評価せずにその旨を表示')
ok(all(c['cmf'].get('V') is None for c in r['cands'] if c['cmf'] and not c['cmf'].get('ex')),'景観は0扱いにしない')
ok(r['sel']==1,'景観なしでも、静かさと激坂で比べて結果が出る');close(b)

# ---------- 5. 橋の補正: 谷底を拾う標高で擬似的な急勾配が出ても、橋と確認できれば消える。実在する激坂は消えない ----------
midlon=(S[1]+G[1])/2
def trench(la,lo):   # ルート中央の約200mだけ、DEMが谷底(−60m)を拾う
    return 140.0 if abs(lo-midlon)<0.001 and abs(la-35.9)<0.0008 else 200.0
def edgesBridge(pts):
    L=plen(pts)/1000;a=L*0.5-0.1;
    return [{'length':a,'road_class':'residential','use':'road','travel_mode':'bicycle'},{'length':0.2,'road_class':'residential','use':'road','travel_mode':'bicycle','bridge':True},{'length':L-a-0.2,'road_class':'residential','use':'road','travel_mode':'bicycle'}]
env=Env(route=direct,edges=edgesOf(),elev=trench)
r,pg,b=run(env,'cmf');Hno=r['cands'][0]['cmf']['H'];gno=r['cands'][0]['gain'];n15no=r['cands'][0]['cmf']['g']['n15'];close(b)
env=Env(route=direct,edges=edgesBridge,elev=trench)
r,pg,b=run(env,'cmf');Hb=r['cands'][0]['cmf']['H'];gb=r['cands'][0]['gain'];close(b)
print('bridge: H without flag %.2f gain %s n15 %s / with bridge flag H %.2f gain %s'%(Hno,gno,n15no,Hb,gb))
ok(Hno<0.9 and n15no>=1,'橋と確認できないときは、谷底の標高による急勾配がペナルティになる(実在の激坂と区別できないため消さない)')
ok(Hb>0.99 and gb<gno,'橋と確認できた区間だけ標高を補正すると、擬似的な急勾配と獲得標高の水増しが消える')
# 実在する激坂(橋ではない)は、別の場所に橋があっても残る
def ramp(la,lo):   # 西側の約400mに実在する16%の登り(橋ではない)
    x=(lo-S[1])*90110
    return 200.0+max(0,min(400,x-300))*0.16 if x<700 else 264.0
env=Env(route=direct,edges=edgesBridge,elev=lambda la,lo: ramp(la,lo) if lo<midlon-0.002 else (140.0 if abs(lo-midlon)<0.001 and abs(la-35.9)<0.0008 else 264.0))
r,pg,b=run(env,'cmf');g=r['cands'][0]['cmf']['g']
ok(g['n15']>=1 and g['m15']>=300,('橋を補正しても、実在する15%以上の登りは残る',g))
ok('15%以上の登りが' in r['text'] and '除外していません' in r['text'],'15%以上は警告のみ(除外しない)');close(b)

# ---------- 6. 複数区間・長いルートでも道路属性を取得できる ----------
env=Env(route=direct,edges=edgesOf())
r,pg,b=run(env,'cmf',pts=[S,(35.9,139.1),(35.905,139.11),G])
ok(len(env.tr)>=1 and all(len(t)>=2 for t in env.tr),'経由地つき(3区間相当)のルートでも、形状から属性を取得できる')
ok(pg.evaluate("__rt.st.sel.sfDone")==True and pg.evaluate("__rt.st.sel.paved")==1,'経由地つきでも舗装率を取得できる')
env.tr.clear()
pg.evaluate("""(async()=>{const pts=[];for(let i=0;i<=400;i++)pts.push([35.9,139+i*0.0005]);window.__e=await __rt.attrsOf({pts})})()""");pg.wait_for_timeout(1500)
ok(len(env.tr)==1 and abs(plen(env.tr[0])-plen([(35.9,139+i*0.0005) for i in range(401)]))<5,('約18kmのルートは分割せず1回で問い合わせる',len(env.tr)))
env.tr.clear()
pg.evaluate("""(async()=>{const pts=[];for(let i=0;i<=2000;i++)pts.push([35.9,139+i*0.001]);window.__e=await __rt.attrsOf({pts})})()""");pg.wait_for_timeout(2500)
ok(len(env.tr)>=3 and abs(sum(plen(t) for t in env.tr)-plen([(35.9,139+i*0.001) for i in range(2001)]))<20 and max(plen(t) for t in env.tr)<62000+1500,('約180kmは3回以上に分割し、1回の長さは約60km以下',len(env.tr),max(plen(t) for t in env.tr)));close(b)

# ---------- 10. 自転車で走れると確認できた候補を優先する(押し歩き・階段の多い候補は、スコアが高くても、ほかに候補があれば選ばない) ----------
def edgesWalky(pts):
    busy=max(la for la,lo in pts)<35.901;L=plen(pts)/1000
    if busy:return [{'length':L,'road_class':'residential','use':'road','travel_mode':'bicycle','surface':'paved_smooth'}]
    return [{'length':L*0.6,'road_class':'residential','use':'cycleway','travel_mode':'bicycle'},{'length':L*0.4,'use':'steps','travel_mode':'pedestrian'}]
env=Env(route=direct,alt=detourN,edges=edgesWalky,feat=[])
r,pg,b=run(env,'cmf')
ok(r['cands'][1]['cmf']['walkM']>500 and r['sel']==0,('押し歩き区間が長い候補より、走れると確認できた候補を選ぶ',r['sel'],[c['cmf'].get('walkM') for c in r['cands']]));close(b)
# ---------- 11. 最小獲得標高でも、橋と確認できた区間の標高補正を、選んだルートに適用する(追加の問い合わせは増やさない) ----------
env=Env(route=direct,edges=edgesBridge,elev=trench)
r,pg,b=run(env,'min',wait=1200)
t=pg.evaluate("document.querySelector('#cards').textContent");g=pg.evaluate("__rt.st.sel.gain")
ok('橋・トンネルと確認できた区間の標高を補正済み' in t and g==0,('最小獲得標高でも、選んだルートの橋の補正が反映される',g))
ok(len(env.tr)==1 and len(env.reqs)==1,'属性の取得は選んだルートの1回のまま')
close(b)
env=Env(route=direct,edges=edgesOf(),elev=trench)
r,pg,b=run(env,'min',wait=1200);t=pg.evaluate("document.querySelector('#cards').textContent")
ok('補正済み' not in t and pg.evaluate("__rt.st.sel.gain")>0,'橋の根拠がなければ補正しない(標高は変えない)');close(b)
# ---------- 12. 再読み込み後の復元(快適・絶景) ----------
env=Env(route=direct,alt=detourN,edges=edges1,feat=VP)
r,pg,b=run(env,'cmf')
pg.evaluate("localStorage.setItem('rt-state',JSON.stringify({points:__rt.st.points,closures:[],detour:'1.5',obj:'cmf'}))")
pg.reload();pg.wait_for_function('typeof __rt!=="undefined"',timeout=20000);pg.wait_for_selector('#cards .stats',timeout=20000);pg.wait_for_timeout(500)
t=pg.evaluate("document.querySelector('#cards').textContent")
ok(pg.input_value('#obj')=='cmf' and '快適スコア' in t,'再読み込み後も、選択と快適・絶景の結果が復元される');close(b)
done('comfort-flow')
