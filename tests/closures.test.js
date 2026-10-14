// node tests/closures.test.js  (ブラウザ部品をスタブにして、判定と保存形式だけを試す)
const assert=require('assert');let n=0;const eq=(a,b,m)=>{assert.deepStrictEqual(a,b,m);console.log('ok',m);n++};
const store={};global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}};
global.document={querySelector:()=>null};global.window=global;
// 旧形式(保存済みデータ)を先に置く → 読み込み時にGeoJSON相当へ変換される
store['rt-confirmed']=JSON.stringify([{key:'k|旧線|',route:'旧線',status:'通行止め',position:'推定',sourceName:'S',sourceUrl:'u',fetchedAt:'t',ways:[{id:1,pts:[[35.9,139.0],[35.9,139.01]]}]}]);
require('../route/closures.js');const C=global.Closures;
eq(C.active(),true,'旧形式の保存データを引き継ぐ');
// 旧データ: 東西約900mの線。ルートが「まばらな頂点」で線を横切る(頂点同士は30m以上離れる)
const cross=[[35.8995,139.005],[35.9005,139.005]]; // 約111m、南北に横断。線までの距離0
eq(C.hits(cross).length,1,'頂点が離れていても、横断を検出(区間単位の交差)');
const far=[[35.91,139.005],[35.911,139.005]];
eq(C.hits(far).length,0,'離れたルートは検出しない');
const par=[[35.90030,139.0],[35.90030,139.01]]; // 約33m北を平行
eq(C.hits(par).length,0,'30mより離れた平行は検出しない');
const par2=[[35.90020,139.0],[35.90020,139.01]]; // 約22m
eq(C.hits(par2).length,1,'30m以内の平行は検出');
// 除外点: 予算内、線の上
const sp=C.samplePoints(10);eq([sp.length>=1,sp.length<=10,sp.every(p=>Math.abs(p.lat-35.9)<1e-3)],[true,true,true],'除外点は線上で予算内');
// 短い線でも1点は置く
const sp2=C.samplePoints(1);eq(sp2.length,1,'予算1でも1点');
// GeoJSON出力: [経度,緯度]、MultiLineString
const gj=C.exportGeoJSON();const g=gj.features[0].geometry;
eq([gj.type,g.type,g.coordinates[0][0]],['FeatureCollection','MultiLineString',[139,35.9]],'GeoJSON(EPSG:4326, 経度緯度の順)');
eq(gj.features[0].properties.route,'旧線','属性に出典・路線名を保持');
// 不明(区間なし)の道は、除外せず警告のみ
eq(C.warnings(cross),[],'未取得時は警告なし');
// 除外追加(再計算用)
C.addBoost(C.hits(cross));eq(C.samplePoints(5)[0].lat>35.89,true,'検証で見つかった交差点を優先して除外');
console.log('\n全',n,'件OK');
