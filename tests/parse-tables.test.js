const assert=require('assert');const P=require('../route/parse-tables.js');let n=0;const ok=(c,m)=>{assert(c,m);console.log('ok',m);n++};
const c=P.classify;
ok(c('通行止め','全線').status==='通行止め'&&c('通行止め','全線').scope==='whole','通行止め・全線');
ok(c('通行禁止','全線').status==='通行止め','「通行禁止」も通行止めとして扱う(黙って除外しない)');
ok(c('全面閉鎖','').status==='通行止め','「閉鎖」');
ok(c('一部区間通行止め','全線').scope==='partial','種類が一部区間なら、区間欄に全線とあっても一部');
ok(c('大型車通行止め','').status==='一部規制','大型車のみは一部規制');
ok(c('お知らせ','').status==='不明','分類できないものは「不明」(通行可とはしない)');
console.log('\n全',n,'件OK');
