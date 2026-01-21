const fs=require('fs');
const src=fs.readFileSync('app/viewer.js','utf8');
try{
  new Function(src);
  console.log('parse ok');
}catch(e){
  console.error('error message:', e.message);
  const lines = src.split(/\r?\n/);
  const n = lines.length;
  console.log('total lines', n);
  for(let i=1;i<=n;i++){
    if(i<=15 || (i>=120 && i<=160) || (i>=170 && i<=200) || (i>=1 && i<=n && i%100===0)){
      console.log(i, lines[i-1]);
    }
  }
}
