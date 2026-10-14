const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};global.document={querySelector:()=>null};global.window=global;
store['rt-confirmed']=JSON.stringify([{key:'a',route:'A'},{key:'b',route:'B',ways:[{id:1}]},{key:'c',route:'C',ways:[{pts:[[35.9,139],[35.9,139.01]]}]}]);
require('../route/closures.js');const C=Closures;
const g=JSON.parse(store['rt-confirmed-gj']);if(g.features.length!==1||g.features[0].properties.route!=='C')throw 'bad '+JSON.stringify(g.features.map(f=>f.properties.route));
if(!store['rt-confirmed'])throw '旧データが消えた';
C.hits([[35.9,139.005],[35.9001,139.005]]);console.log('ok 旧データの欠損は無視して移行し、旧データは残す');
