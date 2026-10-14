// node tests/autoavoid.test.js  (自動で避ける対象の判定: 通行止め+位置を特定できたものだけ)
const assert=require('assert');let n=0;const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);n++};
const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};
global.document={querySelector:()=>null};global.window=global;
require('../route/closures.js');const C=global.Closures;
const L=[[35.9,139.0],[35.9,139.01]];
const mk=(o)=>({sourceName:'S',route:o.route,municipality:'M',section:o.section||'',status:o.status||'通行止め',scope:o.scope,selected:o.selected===undefined?{confidence:o.conf||'中',pts:L,ways:[{pts:L}]}:o.selected,usable:[],ways:[{pts:L}]});
C._test.setFound([
 mk({route:'全線',scope:'whole'}),
 mk({route:'区間高',scope:'partial',conf:'高'}),
 mk({route:'区間中',scope:'partial',conf:'中'}),
 mk({route:'位置不明',scope:'whole',selected:null}),
 mk({route:'一部規制',scope:'whole',status:'一部規制'}),
]);
eq(C._test.autoAvoid().map(x=>x.route),['全線','区間高'],'通行止め+全線/確度高だけ自動で避ける');
eq(C.hits([[35.8995,139.005],[35.9005,139.005]]).map(h=>h.route),['全線','区間高'],'自動対象を横切るとhitsに出る');
eq(C.warnings([[35.8995,139.005],[35.9005,139.005]]).map(w=>w.route),['区間中','位置不明','一部規制'],'自動対象は警告に重複して出さず、推定・不明・一部規制は警告に残る');
eq(C.active(),true,'自動対象があればactive');
console.log(`全 ${n} 件OK (autoavoid)`);
