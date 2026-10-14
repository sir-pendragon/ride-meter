// node tests/locate.test.js
const assert=require('assert');const L=require('../route/locate.js');
let n=0;const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);console.log('ok',m);n++};
// 区間文言
const ps=(t,s)=>L.parseSection(t,s);
eq(ps('起点より3.5km～終点').type+ps('起点より3.5km～終点').fromKm+'/'+ps('起点より3.5km～終点').toKm,'km3.5/null','起点より3.5km～終点');
eq(ps('起点から２ｋｍ～４ｋｍ').toKm,4,'全角数字・km');
eq(ps('全線(秩父市浦山地内)','whole').type,'whole','全線');
const lm=ps('大久保橋～矢久峠');eq([lm.type,lm.a,lm.b],['landmark','大久保橋','矢久峠'],'目印2つ');
eq(ps('土坂峠～矢久峠').type,'landmark','峠と峠');
eq(ps('落石のため').type,'unknown','読み取れない文言は不明');
// 合成データ: 東西に約4.0km(lat固定)の道 + 別の場所に同名の道
const lon0=139.0,lat0=35.9,dlon=(m)=>m/(111320*Math.cos(35.9*Math.PI/180));
const line=(lat,lonStart,mStart,mEnd,step=200)=>{const p=[];for(let m=mStart;m<=mEnd;m+=step)p.push({lat,lon:lonStart+dlon(m)});return p};
const el=(id,name,geom)=>({type:'way',id,tags:{name,highway:'track'},geometry:geom});
// 道A: 0→4000m (2本のwayがつながる)
const A1=el(1,'林道長久保線',line(lat0,lon0,0,2000)), A2=el(2,'林道長久保線',line(lat0,lon0,2000,4000));
// 道B: 同名・別の場所(約20km北)
const B1=el(3,'林道長久保線',line(lat0+0.2,lon0,0,3000));
const rec=(o)=>({route:'長久保線',municipality:'秩父市',scope:'partial',section:'起点より3.5km～終点',...o});
// 1. 同名複数: 自動確定しない
let r=L.locate([rec({scope:'whole',section:'全線'})],[A1,A2,B1])[0];
eq([r.candidates.length>=2,r.selected,r.position.multiple],[true,null,true],'同名2か所→自動確定しない');
// 2. 市町村で絞る(Bは別の市)
const muniOf=(lat)=>lat>lat0+0.1?'小鹿野町':'秩父市';
r=L.locate([rec({scope:'whole',section:'全線'})],[A1,A2,B1],{muniOf})[0];
eq([r.selected&&r.selected.lengthM>3900&&r.selected.lengthM<4100, r.position.level],[true,'推定'],'市町村で1か所に絞れる→推定(確定ではない)');
eq(/小鹿野町の同名の道を除外/.test(r.position.reason),true,'除外理由を記録');
// 3. 市町村が一致するものが無い
r=L.locate([rec({municipality:'飯能市',scope:'whole',section:'全線'})],[A1,B1],{muniOf})[0];
eq([r.position.level,r.ways.length],['なし',0],'市町村不一致→位置なし');
// 4. 起点からの距離: 両端からの2案、確定しない
r=L.locate([rec()],[A1,A2],{muniOf})[0];
eq(r.usable.length,2,'起点側が不明なため2案');
eq(r.selected,null,'2案は自動確定しない');
const lens=r.usable.map(u=>Math.round((u.d1-u.d0)));
eq(lens.every(x=>Math.abs(x-500)<30),true,'3.5km～終点(全長4.0km)は約500m');
// 5. 起点より5km (全長4kmより長い) → 不明
r=L.locate([rec({section:'起点より5.0km～終点'})],[A1,A2])[0];
eq(r.position.level,'不明','道の長さを超える距離は不明');
// 6. 橋名・峠名
const lmk=L.parseLandmarks([{type:'way',id:9,tags:{name:'大久保橋',bridge:'yes'},center:{lat:lat0+0.0001,lon:lon0+dlon(1000)}},{type:'node',id:10,lat:lat0,lon:lon0+dlon(3000),tags:{name:'矢久峠',natural:'saddle'}}]);
r=L.locate([rec({section:'大久保橋～矢久峠'})],[A1,A2],{landmarks:lmk})[0];
eq([r.position.level,r.position.confidence,Math.abs(r.selected.d1-r.selected.d0-2000)<10],['推定','中',true],'橋名と峠名で区間を切り出す(約2000m)');
// 7. 目印がOSMに無い
r=L.locate([rec({section:'国道299号分岐～矢久峠'})],[A1,A2],{landmarks:lmk})[0];
eq([r.position.level,r.selected],['不明',null],'目印が見つからない→不明(地図に出さない)');
// 8. 同名なし
r=L.locate([rec({route:'存在しない線'})],[A1])[0];
eq(r.position.level,'なし','OSMに無い→なし');
// 9. 名前の表記ゆれ ケ/ヶ
const K=el(11,'林道三ヶ山線',line(lat0,lon0,0,1000));
r=L.locate([rec({route:'三ケ山線',scope:'whole',section:'全線'})],[K])[0];
eq(r.position.level,'推定','ケ/ヶの表記ゆれ');
// 切り出し・投影
const path=[[0,0],[0,0.01]];const cut=L.cutPath(path,0,500);
eq(Math.abs(L.project(path,[0.0001,0.005]).along-555.9)<2,true,'投影の距離');
console.log('\n全',n,'件OK');
// 追加: 橋が通行不可
{const e2=(id,name,geom)=>({type:'way',id,tags:{name,highway:'track'},geometry:geom});
const lonA=139.0;const d=(m)=>m/(111320*Math.cos(35.9*Math.PI/180));
const W=e2(31,'林道太田部峠2号線',Array.from({length:11},(_,i)=>({lat:35.9,lon:lonA+d(i*200)})));
const lmk=L.parseLandmarks([{type:'way',id:5,tags:{name:'大久保橋',bridge:'yes'},center:{lat:35.9,lon:lonA+d(1000)}}]);
const r=L.locate([{route:'太田部峠2号線',municipality:'秩父市',scope:'partial',section:'大久保橋通行不可'}],[W],{landmarks:lmk})[0];
assert(r.selected&&Math.abs(r.selected.d1-r.selected.d0-120)<3);console.log('ok 橋の通行不可は前後60mの区間');}
