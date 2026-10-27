// Mock DOM + onnxruntime to exercise the provider's real code paths.
function mkCanvas(){ const c={width:0,height:0,_d:null,
  getContext(){ const self=c; return { filter:'none',
    drawImage(){}, getImageData(x,y,w,h){ const d=new Uint8ClampedArray(w*h*4); for(let i=0;i<d.length;i+=4){d[i]=200;d[i+1]=150;d[i+2]=100;d[i+3]=255;} return {data:d,width:w,height:h}; },
    createImageData(w,h){ return {data:new Uint8ClampedArray(w*h*4),width:w,height:h}; },
    putImageData(id){ self._d=id; } }; } }; return c; }
global.document={createElement:()=>mkCanvas()};
global.window=global; global.navigator={gpu:undefined};
let runs=0, failFirstShape=false;
global.fetch=async(url)=>{ if(url.startsWith('models/')) return {ok:false,status:404,headers:{get:()=>''}}; const len=3000000; let sent=0; return {ok:true,headers:{get:(k)=>k==='content-length'?String(len):'application/octet-stream'},body:{getReader(){return{read:async()=>{ if(sent>=len) return {done:true}; sent+=1000000; return {done:false,value:new Uint8Array(1000000)}; }}}}}; };
global.ort={ env:{wasm:{}}, Tensor:class{constructor(t,d,dims){this.type=t;this.data=d;this.dims=dims;}},
  InferenceSession:{ create: async(bytes,opt)=>{ if(!(bytes instanceof Uint8Array)) throw new Error('expected downloaded bytes');
    return { inputNames:['input'], outputNames:['output'], release(){},
      run: async(feeds)=>{ runs++; const t=feeds.input; const [,,h,w]=t.dims;
        if(failFirstShape && (h!==512||w!==512)) throw new Error('shape mismatch');
        const a=new Float32Array(h*w); for(let i=0;i<a.length;i++) a[i]=(i%w)<w/2?1:0; return {output:new ort.Tensor('float32',a,[1,1,h,w])}; } }; } } };
require('/tmp/g/full/js/providers/modnet-provider.js');
(async()=>{
  const P=new window.VS.MODNetSegmentationProvider(); await P.initialize('balanced');
  const v={videoWidth:1280,videoHeight:720};
  let r=await P.segment(v); const m=r.segmentationMask;
  console.log('dynamic: model input',P._mw+'x'+P._mh,'mask',m.width+'x'+m.height,'alpha L/R', m._d.data[3], m._d.data[(m.width-1)*4+3], 'label:',P.label);
  const P2=new window.VS.MODNetSegmentationProvider(); await P2.initialize('fast'); failFirstShape=true;
  r=await P2.segment({videoWidth:720,videoHeight:1280});
  console.log('fixed-512 fallback: input',P2._mw+'x'+P2._mh,'mask',r.segmentationMask.width+'x'+r.segmentationMask.height);
})().catch(e=>{console.error('TEST FAIL',e);process.exit(1)});
