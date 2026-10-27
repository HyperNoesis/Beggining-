// QR encoder check: encode many strings, render to images, decode them with OpenCV's QR detector (independent decoder).
const vm=require('vm'),fs=require('fs'),path=require('path'),cp=require('child_process'),os=require('os');
const ctx={window:{}};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/qr.js'),'utf8'),ctx);
const QR=ctx.VS.QR;let bad=0;const t=(n,c,d)=>{if(!c)bad++;console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+d:''))};
const cases=[['a','M'],['https://example.com','M'],['https://example.com','L'],['@genesis.studio','M'],
 ['https://genesis.example/watch?room=ABC123&ref=lowerthird','M'],['x'.repeat(60),'L'],['Hello, Nigeria! Ẹ kú àbọ̀ 🇳🇬','M'],
 ['https://example.com/'+'abcdefghij'.repeat(10),'M'],['https://example.com/'+'q'.repeat(150),'M'],['z'.repeat(200),'M'],['y'.repeat(260),'L']];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qr'));const manifest=[];
cases.forEach(([txt,ecc],i)=>{const q=QR.encode(txt,ecc);if(!q){t('encode '+i,false,'null');return;}
 const S=8,B=4,n=(q.size+2*B)*S;const buf=Buffer.alloc(n*n,255);
 for(let y=0;y<q.size;y++)for(let x=0;x<q.size;x++)if(q.get(x,y))for(let dy=0;dy<S;dy++)for(let dx=0;dx<S;dx++)buf[((y+B)*S+dy)*n+(x+B)*S+dx]=0;
 const f=path.join(dir,i+'.pgm');fs.writeFileSync(f,Buffer.concat([Buffer.from('P5\n'+n+' '+n+'\n255\n'),buf]));manifest.push({f,txt,ver:q.version});});
t('too long returns null',QR.encode('w'.repeat(400),'M')===null);t('empty returns null',QR.encode('','M')===null);
fs.writeFileSync(path.join(dir,'m.json'),JSON.stringify(manifest));
const py=`import cv2,json,sys\nm=json.load(open(sys.argv[1]))\nd=cv2.QRCodeDetector()\nfor i,c in enumerate(m):\n  img=cv2.imread(c['f'],0)\n  v,_,_=d.detectAndDecode(img)\n  print(json.dumps({'i':i,'ok':v==c['txt'],'ver':c['ver'],'got':v[:40]}))\n`;
fs.writeFileSync(path.join(dir,'d.py'),py);
const out=cp.execSync('python3 '+path.join(dir,'d.py')+' '+path.join(dir,'m.json')).toString().trim().split('\n').map(JSON.parse);
out.forEach(o=>t('decodes case '+o.i+' (version '+o.ver+')',o.ok,o.ok?'':o.got));
process.exit(bad?1:0);
