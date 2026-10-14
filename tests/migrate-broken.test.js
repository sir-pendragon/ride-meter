const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};global.document={querySelector:()=>null};global.window=global;
store['rt-confirmed-gj']=JSON.stringify({type:'FeatureCollection',features:[null,{type:'Feature',geometry:{type:'LineString',coordinates:[[139,35.9],[139.01,35.9]]},properties:{key:'k',route:'R'}}]});
require('../route/closures.js');const C=Closures;
if(!C.active())throw '壊れたfeatureで全部消えた';
store2={};
console.log('ok 壊れたfeatureがあっても、残りは読み込む');
