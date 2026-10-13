// 自転車旅ノート: 端末内(IndexedDB)保存。claude.ai版のdb/user/downloadsと同じ使い方ができる互換層。
// データはこの端末のブラウザ内にだけ保存され、どこにも送信されません。
(function(){
const DBN='jitensha-tabi-note',ST='docs',APP='jitensha-tabi-note';
const mem=new Map(),subs=new Set();let idb=null,ready=null;
const clone=v=>JSON.parse(JSON.stringify(v));
const rid=()=>Math.random().toString(36).slice(2,12)+Date.now().toString(36).slice(-6);
const wrapErr=e=>{const n=e&&e.name;return{code:n==='QuotaExceededError'?'quota_exceeded':'storage_error',message:String(e&&e.message||e)}};
function open(){return new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>r.result.createObjectStore(ST);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error('blocked'))})}
function loadAll(){return new Promise((res,rej)=>{const q=idb.transaction(ST).objectStore(ST).openCursor();q.onsuccess=()=>{const c=q.result;if(c){mem.set(c.key,c.value);c.continue()}else res()};q.onerror=()=>rej(q.error)})}
function persist(ops){return new Promise((res,rej)=>{const tx=idb.transaction(ST,'readwrite');const os=tx.objectStore(ST);for(const[p,v]of ops){if(v===undefined)os.delete(p);else os.put(v,p)}tx.oncomplete=()=>res();tx.onerror=()=>rej(wrapErr(tx.error));tx.onabort=()=>rej(wrapErr(tx.error))})}
function notify(){for(const f of [...subs])try{f()}catch(e){}}
async function commit(ops){await persist(ops);for(const[p,v]of ops){if(v===undefined)mem.delete(p);else mem.set(p,v)}notify()}
const seg=p=>p.split('/');
const snapDoc=p=>({id:seg(p).pop(),exists:mem.has(p),data:()=>mem.has(p)?clone(mem.get(p)):undefined,metadata:{}});
function children(path){const n=seg(path).length+1;const out=[];for(const k of mem.keys())if(k.startsWith(path+'/')&&seg(k).length===n)out.push(k);return out}
function docRef(path){return{id:seg(path).pop(),path,
  get:async()=>snapDoc(path),
  set:async d=>{await commit([[path,clone(d)]])},
  update:async d=>{const cur=mem.has(path)?clone(mem.get(path)):{};const nx=Object.assign(cur,clone(d));for(const k of Object.keys(nx))if(nx[k]&&nx[k].__delete__)delete nx[k];await commit([[path,nx]])},
  delete:async()=>{await commit([[path,undefined]])},
  onSnapshot:(next)=>{const f=()=>next(snapDoc(path));subs.add(f);setTimeout(f,0);return()=>subs.delete(f)},
  collection:p=>colRef(path+'/'+p)}}
function colRef(path,ord){const q={path,
  doc:id=>docRef(path+'/'+(id||rid())),
  orderBy:(f,dir)=>colRef(path,{f,dir}),where:()=>q,limit:()=>q,
  _docs:()=>{let ks=children(path).map(k=>({id:seg(k).pop(),data:()=>clone(mem.get(k))}));if(ord){const m=ord.dir==='desc'?-1:1;ks=ks.sort((a,b)=>{const x=a.data()[ord.f],y=b.data()[ord.f];return(x>y?1:x<y?-1:0)*m})}return ks},
  get:async()=>{const docs=q._docs();return{docs,size:docs.length,empty:!docs.length}},
  onSnapshot:(next)=>{const f=()=>{const docs=q._docs();next({docs,size:docs.length,empty:!docs.length,metadata:{}})};subs.add(f);setTimeout(f,0);return()=>subs.delete(f)}};return q}
const db={doc:docRef,collection:p=>colRef(p)};
const user={id:async()=>'local',me:async()=>({id:'local'}),can:async()=>true,isOwner:()=>true,canEdit:()=>true,profiles:async()=>({})};
function saveBlob(filename,blob){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)}
const dl={direct:true,save:async({filename,data})=>{saveBlob(filename,data instanceof Blob?data:new Blob([data]))}};

/* バックアップ: 全体、または1つの旅だけ */
function exportData(tripId){const docs={};for(const[k,v]of mem){if(tripId&&k!=='trips/'+tripId&&!k.startsWith('trips/'+tripId+'/'))continue;docs[k]=v}
  return new Blob([JSON.stringify({app:APP,version:1,exportedAt:new Date().toISOString(),docs})],{type:'application/json'})}
const PATH_OK=/^trips(\/[A-Za-z0-9_.-]{1,60}){1,3}$/;
async function importText(text){let o;try{o=JSON.parse(text)}catch(e){throw new Error('JSONとして読めませんでした')}
  if(!o||o.app!==APP||!o.docs||typeof o.docs!=='object')throw new Error('自転車旅ノートのバックアップではありません');
  const ops=[];let trips=0;for(const[p,v]of Object.entries(o.docs)){const n=seg(p).length;if(!PATH_OK.test(p)||n%2!==0||!v||typeof v!=='object'||Array.isArray(v))continue;ops.push([p,v]);if(n===2)trips++}
  if(!ops.length)throw new Error('取り込める記録が見つかりませんでした');
  for(let i=0;i<ops.length;i+=40)await commit(ops.slice(i,i+40));return{docs:ops.length,trips}}

ready=(async()=>{if(!window.indexedDB)throw new Error('no idb');idb=await open();await loadAll();try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}})().then(()=>true,()=>false);
window.NoteStore={exportData,importText,saveBlob};
window.claude={use:async n=>{const ok=await ready;if(n==='db')return ok?db:null;if(n==='user')return user;if(n==='downloads')return dl;return null}};
})();
