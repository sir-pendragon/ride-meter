// 取得元一覧ページのURLが、closures.js の取得先(SOURCES)と一致していること
const fs = require('fs'); const assert = require('assert');
const js = fs.readFileSync(__dirname + '/../route/closures.js', 'utf8'); const pg = fs.readFileSync(__dirname + '/../route/sources.html', 'utf8');
const urls = [...js.matchAll(/url: '(https:\/\/[^']+)'/g)].map((m) => m[1]).filter((u) => !/cdnjs|overpass|gsi|geocod/.test(u));
assert(urls.length === 11, '取得先が読めない');
for (const u of urls) assert(pg.includes('href="' + u + '"'), '一覧に無い取得先: ' + u);
console.log('全 ' + urls.length + ' 件OK');
