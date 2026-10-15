// node tests/ovpcache.test.js  (closures.jsのOverpass保存: 新しい保存は通信しない/失敗時は古い保存で代用/保存なしは失敗/打ち切り)
const assert=require('assert');let n=0;const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);console.log('ok',m);n++};
const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};
global.document={querySelector:()=>null};global.window=global;
let calls=0,mode='ok';
global.fetch=async(u,o)=>{calls++;
  if(mode==='504') return {ok:false,status:504,json:async()=>({})};
  if(mode==='hang') return new Promise((_,rej)=>{o.signal.addEventListener('abort',()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'})))});
  return {ok:true,status:200,json:async()=>({elements:[{type:'way',id:1}]})}};
require('../route/closures.js');const I=global.Closures._internal;
(async()=>{
  const q='[out:json];way["name"~"A"](1,2,3,4);out geom;';
  let r=await I.overpass(q);eq([r.length,calls],[1,1],'初回は通信して結果を保存する');
  mode='504';r=await I.overpass(q);eq([r.length,calls],[1,1],'7日以内の保存があれば通信しない');
  // 保存を8日前に書き換え → 新しくない。通信して504 → 古い保存で代用
  const o=JSON.parse(store['rt-ovp']);const k=Object.keys(o)[0];o[k].at=Date.now()-8*864e5;store['rt-ovp']=JSON.stringify(o);
  I.resetOvp();r=await I.overpass(q);eq([r.length,calls,I.ovpStale()>0],[1,2,true],'8日前の保存: 通信が失敗したら古い保存で代用し、使ったことを記録');
  // 61日前 → 失敗
  o[k].at=Date.now()-61*864e5;store['rt-ovp']=JSON.stringify(o);I.resetOvp();
  let err=null;try{await I.overpass(q)}catch(e){err=e}
  eq([!!err,I.ovpStale()],[true,0],'61日前の保存は使わず、失敗として扱う');
  // 別の検索(保存なし)で504 → 失敗
  err=null;try{await I.overpass(q+'x')}catch(e){err=e}eq(!!err,true,'保存がない検索は、失敗したら失敗のまま(推測で補わない)');
  // 打ち切り: 保存なし+応答なし → 時間切れ
  global.__rtOvpMs=50;mode='hang';err=null;try{await I.overpass(q+'y')}catch(e){err=e}
  eq(/時間内に終わりませんでした/.test(err&&err.message),true,'応答がなければ打ち切り、混雑のメッセージにする');
  // 容量超過でも例外にならず、最大8件
  mode='ok';delete global.__rtOvpMs;for(let i=0;i<12;i++)await I.overpass(q+'#'+i);
  eq(Object.keys(JSON.parse(store['rt-ovp'])).length<=8,true,'保存は最大8件');
  console.log('全',n,'件OK (ovpcache)');
})().catch(e=>{console.error(e);process.exit(1)});
