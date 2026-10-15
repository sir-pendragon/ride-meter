// node tests/onroute.test.js  (地図: 選んだルートが通る規制の道だけを描く。近くを通るだけ・遠い道は描かない)
const assert=require('assert');let n=0;const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);console.log('ok',m);n++};
const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};
global.document={querySelector:()=>null};global.window=global;
store['rt-confirmed']=JSON.stringify([{key:'k|旧線|',route:'旧線',status:'通行止め',position:'推定',sourceName:'S',sourceUrl:'u',fetchedAt:'t',ways:[{id:1,pts:[[35.9,139.0],[35.9,139.01]]}]}]);
require('../route/closures.js');const C=global.Closures;
const drawn=[];const mk=(o)=>({addTo(){drawn.push(o);return this},bindPopup(){return this},bindTooltip(t){o.tip=t;return this}});
const grp={clearLayers(){drawn.length=0},addTo(){return this}};
C._test.setCtx({map:{},L:{layerGroup:()=>grp,polyline:(l,o)=>mk({l,o})},esc:x=>x});
// 旧線(35.9,139.0→139.01)を南北に横切るルート → 赤の実線で描く
let r=C.drawOnRoute([[35.8995,139.005],[35.9005,139.005]]);
eq([r,drawn.length,drawn[0].o.color,drawn[0].o.dashArray],[1,1,'#B3261E',undefined],'ルートが通る確定の規制: 赤の実線で1本描く');
eq(/旧線/.test(drawn[0].tip),true,'ツールチップに路線名');
// 約300m離れたルート → 描かない
r=C.drawOnRoute([[35.9030,139.005],[35.9040,139.005]]);eq([r,drawn.length],[0,0],'近くを通るだけ(30m超)のルートでは描かない');
// 空・nullで例外にならず、描画を消す
C.drawOnRoute([[35.8995,139.005],[35.9005,139.005]]);r=C.drawOnRoute(null);eq([r,drawn.length],[0,0],'ルートなし(null)では描画を消す');
// 推定(橙の破線)・不明(灰の点線): 通る場合だけ描く
C._test.setFound([
  {key:'e',route:'推定線',status:'通行止め',ways:[{pts:[[35.80,139.0],[35.80,139.01]]}],usable:[{pts:[[35.80,139.002],[35.80,139.008]],level:'推定',confidence:'中'}],selected:null,sourceName:'S',sourceUrl:'u',fetchedAt:'t'},
  {key:'u',route:'不明線',status:'通行止め',ways:[{pts:[[35.70,139.0],[35.70,139.01]]}],usable:[],selected:null,sourceName:'S',sourceUrl:'u',fetchedAt:'t'},
  {key:'f',route:'遠い線',status:'通行止め',ways:[{pts:[[36.50,139.0],[36.50,139.01]]}],usable:[],selected:null,sourceName:'S',sourceUrl:'u',fetchedAt:'t'}]);
const route=[[35.7995,139.005],[35.8005,139.005],[35.6995,139.005],[35.7005,139.005]];
r=C.drawOnRoute(route);
const est=drawn.find(d=>/推定線/.test(d.tip||'')),unk=drawn.find(d=>/不明線/.test(d.tip||''));
eq([!!est&&est.o.color,!!est&&est.o.dashArray],['#C25A12','8 6'],'位置が推定の規制: 橙の破線');
eq([!!unk&&unk.o.color,!!unk&&unk.o.dashArray],['#6B6B6B','2 8'],'区間不明の規制: 灰の点線');
eq(drawn.some(d=>/遠い線/.test(d.tip||'')),false,'ルートから遠い規制は描かない');
console.log('全',n,'件OK (onroute)');
