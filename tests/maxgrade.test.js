const fs=require('fs');const h=fs.readFileSync(__dirname+'/../route/index.html','utf8');
const m=h.match(/const GRADE_WIN[\s\S]*?\nfunction maxGrade[^\n]*\n/);const maxGrade=new Function(m[0]+';return maxGrade')();
let f=0;const ok=(c,n)=>{if(!c){console.log('NG',n);f++}};
const mk=(zf)=>{const n=401,s=[],z=[];for(let i=0;i<n;i++){s.push(i*10);z.push(zf(i*10))}return[{s,total:4000},z]};
let [D,z]=mk(x=>x*0.10);let r=maxGrade(D,z);ok(Math.abs(r.g-0.10)<1e-6&&r.excl===0,'10%一定');
[D,z]=mk(x=>x<2000?x*0.05:x<2100?100+(x-2000)*0.66:166+(x-2100)*0.05);r=maxGrade(D,z);ok(r.excl>=1,'66%スパイクは除外');ok(r.g<0.3,'除外後は30%未満');
[D,z]=mk(x=>x*0.25);r=maxGrade(D,z);ok(Math.abs(r.g-0.25)<1e-6&&r.excl===0,'25%は有効');
console.log(f?`NG ${f}`:'全 3 件OK (maxGrade)');process.exit(f?1:0)
