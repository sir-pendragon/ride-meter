// node tests/fetchcore.test.js
const assert=require('assert');
const FC=require('../route/fetchcore.js');
const mem=()=>{const m={};return{getItem:k=>m[k]??null,setItem:(k,v)=>{m[k]=String(v)},_m:m}};
let t=0;const T=1e12;let clock=T;
let mem0;const mk=()=>FC.create({storage:(mem0=mem()),now:()=>clock,sleep:async ms=>{sleeps.push(ms)}});
let sleeps=[];
const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);console.log('ok',m);t++};
(async()=>{
 // 1 初回: 解析される
 let parses=0;const parse=async d=>{parses++;return d.split(',').map(x=>({route:x}))};
 let s=mk();let fetches=0;const fetcher=data=>async()=>{fetches++;return{data,meta:{fetchedAt:'x'}}};
 let r=await s.load({key:'u',label:'L',fetcher:fetcher('a,b'),parse});
 eq([r.status,r.records.length,parses,fetches],['更新',2,1,1],'初回は取得して解析する');
 // 2 10分以内: アクセスしない
 clock+=60e3;r=await s.load({key:'u',label:'L',fetcher:fetcher('a,b'),parse});
 eq([r.status,parses,fetches],['キャッシュ',1,1],'10分以内は公式サイトへアクセスしない');
 // 3 10分後・同じ内容: 再解析しない
 clock+=11*60e3;r=await s.load({key:'u',label:'L',fetcher:fetcher('a,b'),parse});
 eq([r.status,parses,fetches],['変更なし',1,2],'同じハッシュなら再解析を省略');
 // 4 内容が変わった: 再解析
 clock+=11*60e3;r=await s.load({key:'u',label:'L',fetcher:fetcher('a,b,c'),parse});
 eq([r.status,r.records.length,parses],['更新',3,2],'内容が変われば再解析');
 // 5 一時エラー(503)は指数バックオフで再試行して成功
 sleeps=[];clock+=11*60e3;let n=0;
 r=await s.load({key:'u',label:'L',fetcher:async()=>{if(n++<2){const e=new Error('x');e.status=503;throw e}return{data:'a,b,c,d',meta:{}}},parse});
 eq([r.status,r.records.length,n,sleeps.length],['更新',4,3,2],'503は再試行して成功');
 assert(sleeps[1]>sleeps[0]);eq(true,true,'待ち時間が増える(指数バックオフ)');
 // 6 通信エラーが続く: 古い内容を「情報期限切れ」として返す
 sleeps=[];clock+=11*60e3;
 r=await s.load({key:'u',label:'L',fetcher:async()=>{const e=new Error('boom');e.status=503;throw e},parse});
 eq([r.status,r.stale,r.records.length,sleeps.length],['情報期限切れ',true,4,2],'失敗が続くと古い内容を期限切れとして返す(最大3回で打ち切り)');
 // 7 404: 古い内容を捨てる(削除されたページ)
 clock+=11*60e3;let calls=0;
 await assert.rejects(()=>s.load({key:'u',label:'L',fetcher:async()=>{calls++;const e=new Error('nf');e.status=404;throw e},parse}),/リンク切れ/);
 eq(calls,1,'404は再試行しない');
 const st=JSON.parse(mem0.getItem('rt-fcache'));
 eq('u' in st,false,'404後は古い内容を捨てる(キャッシュ削除)');
 // 8 解析失敗(構造変更): 古い内容は使わない
 clock+=11*60e3;
 const s2=mk();await s2.load({key:'k',label:'L',fetcher:fetcher('a'),parse});
 clock+=11*60e3;
 await assert.rejects(()=>s2.load({key:'k',label:'L',fetcher:fetcher('zzz'),parse:async()=>{const e=new Error('表を読み取れませんでした');e.kind='parse';throw e}}),/表を読み取れません/);
 eq(s2.getLog().at(-1).result,'解析失敗','構造変更は「解析失敗」として記録');
 // 9 429は再試行対象 / 403は対象外
 eq([FC.isRetryable({status:429}),FC.isRetryable({status:403}),FC.isRetryable({status:404}),FC.isRetryable({})],[true,false,false,true],'再試行の対象');
 console.log('\n全',t,'件OK');
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
