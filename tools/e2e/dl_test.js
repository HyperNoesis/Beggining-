function mkCanvas(){ return {width:0,height:0,getContext(){return {drawImage(){},getImageData(){return{data:new Uint8ClampedArray(4)}}}}}; }
global.document={createElement:()=>mkCanvas()}; global.window=global; global.navigator={};
let creates=0, fetched=[];
global.ort={env:{wasm:{}},Tensor:class{},InferenceSession:{create:async(b,o)=>{creates++; if(!(b instanceof Uint8Array)) throw new Error('expected bytes'); return {inputNames:['input'],outputNames:['output'],release(){}}}}};
const mk=(len)=>({ok:true,headers:{get:(k)=>k==='content-length'?String(len):'application/octet-stream'},body:{getReader(){let sent=0;return{read:async()=>{ if(sent>=len) return {done:true}; const n=Math.min(500000,len-sent); sent+=n; return {done:false,value:new Uint8Array(n)};}}}}});
global.fetch=async(url)=>{ fetched.push(url);
  if(url.startsWith('models/')) return {ok:true,headers:{get:()=> 'text/html'},body:null,arrayBuffer:async()=>new ArrayBuffer(10)}; // Netlify SPA fallback page
  return mk(3000000); };
require('/tmp/g/full/js/providers/modnet-provider.js');
(async()=>{
  const P=new window.VS.MODNetSegmentationProvider(); const prog=[]; P.onProgress=p=>prog.push(Math.round(p*100));
  const t0=Date.now(); await P.initialize('balanced');
  console.log('sources tried:',fetched.length,fetched.map(u=>u.slice(0,30)));
  console.log('HTML fallback page rejected, then HF used; session creates:',creates,'(downloads:',fetched.length-1,'real)');
  console.log('progress events:',prog.join(','),'| ms',Date.now()-t0);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
