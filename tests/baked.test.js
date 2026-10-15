// node tests/baked.test.js  (同梱した林道データ: 形式・復号・絞り込み・Overpass失敗時の代用)
const assert=require('assert'),fs=require('fs');let n=0;const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);console.log('ok',m);n++};
const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};
global.document={querySelector:()=>null};global.window=global;
let ovp='ok',ovpCalls=0;
global.fetch=async(u,o)=>{
  if(/data\/osm-forest\/(\d+)\.json/.test(u)){const f=__dirname+'/../data/osm-forest/'+RegExp.$1+'.json';if(!fs.existsSync(f))return{ok:false,status:404};return{ok:true,json:async()=>JSON.parse(fs.readFileSync(f,'utf8'))}}
  ovpCalls++;if(ovp==='504')return{ok:false,status:504,json:async()=>({})};
  return{ok:true,json:async()=>({elements:[{type:'way',id:9,tags:{name:'林道Overpass線',highway:'track'},geometry:[{lat:35.7,lon:139.1},{lat:35.71,lon:139.1}]}]})}};
global.ClosureLocate=require('../route/locate.js');require('../route/closures.js');
const I=global.Closures._internal;
// ファイルの形式
for(const c of ['13','11']){const j=JSON.parse(fs.readFileSync(__dirname+'/../data/osm-forest/'+c+'.json','utf8'));
  eq([j.v,typeof j.at,Array.isArray(j.ways),j.ways.length>300],[1,'string',true,true],c+'.json: 形式と件数');
  const bad=j.ways.filter(w=>!(w.length===5&&Number.isInteger(w[0])&&w[1].includes('林道')||w[1]));eq(bad.length,0,c+'.json: 各行は[id,名前,種別,舗装,座標]');}
(async()=>{
  const t=await I.loadBaked('13');
  eq([t.els.length,t.els[0].tags.name,t.els[0].type],[574,'林道奥沢線','way'],'東京: 574本を復号');
  const g=t.els[0].geometry;eq(g.every(p=>p.lat>35.5&&p.lat<36&&p.lon>138.8&&p.lon<139.9),true,'東京: 座標が東京都内の範囲に復号される(奥沢線)');
  eq(g.length>=3&&Math.abs(g[0].lat-35.8)<0.2,true,'東京: 先頭の座標が妥当(緯度35.8付近)');
  const allOk=t.els.every(e=>e.geometry.length>=1&&e.geometry.every(p=>p.lat>33.5&&p.lat<36.1&&p.lon>138.8&&p.lon<139.95));
  eq(allOk,true,'東京: 全574本の全点が東京都(伊豆諸島を含む)の範囲内(復号の誤りなし)');
  const s=await I.loadBaked('11');eq(s.els.every(e=>e.geometry.every(p=>p.lat>35.7&&p.lat<36.3&&p.lon>138.6&&p.lon<139.95)),true,'埼玉: 全点が埼玉県付近の範囲内');
  eq(await I.loadBaked('20'),null,'未対応の県(長野)は同梱なし(null)');
  // 絞り込み: 林道奥沢線(奥沢)
  const bb=[35.5,138.8,36,139.9];
  const hit=global.ClosureLocate.filterForest(t.els,[{route:'林道奥沢線'}],bb);
  eq(hit.length>=1&&hit.every(e=>/奥沢/.test(e.tags.name)),true,'路線名「林道奥沢線」で同名の道だけ選ぶ');
  eq(global.ClosureLocate.filterForest(t.els,[{route:'林道奥沢線'}],[10,10,11,11]).length,0,'範囲(bbox)外は選ばない');
  // forestEls: 全県が同梱 → Overpassを呼ばない
  const notes=[];ovpCalls=0;
  let r=await I.forestEls([{route:'林道奥沢線'}],bb,['13'],notes);
  eq([r.length>=1,ovpCalls,/同梱したデータ/.test(notes[0])],[true,0,true],'同梱済みの県だけ: Overpassを呼ばず、同梱データだと明示');
  // 同梱なしの県を含む → Overpass。失敗したら同梱で代用(その旨を明示)
  const n2=[];ovpCalls=0;r=await I.forestEls([{route:'林道奥沢線'}],bb,['13','20'],n2);
  eq([r.length,ovpCalls],[1,1],'同梱なしの県を含むときは、従来どおりOverpass');
  const n3=[];ovp='504';I.resetOvp();r=await I.forestEls([{route:'林道奥沢線'}],[35.5,138.8,36,139.8],['13','20'],n3);
  eq([r.length>=1,/^⚠ OpenStreetMapが混んでいて/.test(n3[0])],[true,true],'Overpass失敗: 同梱の県の道を代用し、理由を明示');
  // Overpass失敗+同梱なし → 失敗のまま
  let err=null;try{await I.forestEls([{route:'林道X線'}],bb,['20'],[])}catch(e){err=e}eq(!!err,true,'同梱なしの県だけでOverpass失敗: 失敗のまま(推測しない)');
  console.log('全',n,'件OK (baked)');
})().catch(e=>{console.error(e);process.exit(1)});
