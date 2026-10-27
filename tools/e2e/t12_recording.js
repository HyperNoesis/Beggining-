const { launch } = require('./pwlib.js');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
(async()=>{const {browser,ctx}=await launch();let errs=[];
 const open=async()=>{const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));await p.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});await p.goto('http://127.0.0.1:8123/app/studio.html');await p.waitForSelector('#startBtn');return p};
 // A: record, simulate a crash (close tab without Stop), recover
 let page=await open();await page.click('#startBtn');await page.waitForTimeout(5000);
 await page.click('#recordBtn');await page.waitForTimeout(9000);
 const mid=await page.evaluate(async()=>{const d=await window.VS.storage.getDraft();return d?{size:d.blob.size,type:d.blob.type}:null});
 ok('draft grows while recording (append-only chunks)',mid&&mid.size>20000,mid);
 await page.close({runBeforeUnload:false});
 page=await open();await page.waitForTimeout(1200);
 ok('recovery banner shown after crash',await page.isVisible('#draftToast .recover-draft-btn'));
 page.on('dialog',d=>d.accept());
 await page.click('#draftToast .recover-draft-btn');await page.waitForTimeout(1500);
 const rec=await page.evaluate(async()=>{const l=await window.VS.storage.listRecordings();const d=await window.VS.storage.getDraft();return {n:l.length,draftLeft:!!d,title:l[0]&&l[0].title}});
 ok('recovered clip saved to Projects, draft cleared',rec.n>=1&&!rec.draftLeft,rec);
 const size=await page.evaluate(async()=>{const l=await window.VS.storage.listRecordings();const r=await window.VS.storage.getRecording(l[0].id);const b=r.blob||r;return b.size});
 ok('recovered clip has real bytes',size>20000,{size});
 // B: normal stop path still works and clears the draft
 await page.click('#startBtn');await page.waitForTimeout(5000);await page.click('#recordBtn');await page.waitForTimeout(5000);await page.click('#recordBtn');await page.waitForTimeout(2500);
 const after=await page.evaluate(async()=>({n:(await window.VS.storage.listRecordings()).length,draft:!!(await window.VS.storage.getDraft()),link:(document.querySelector('.recording-item a')||{}).download}));
 ok('normal stop saves and clears draft',after.n>=2&&!after.draft,after);
 ok('download name has right extension',/\.(webm|mp4)$/.test(after.link||''),after.link);
 // C: MediaRecorder that rejects the preferred mime still records (constructor throws on options)
 await page.evaluate(()=>{const Orig=window.MediaRecorder;window.MediaRecorder=function(s,o){if(o&&o.mimeType)throw new Error('NotSupportedError');return new Orig(s)};window.MediaRecorder.isTypeSupported=()=>true});
 await page.click('#recordBtn');await page.waitForTimeout(3500);const st=await page.evaluate(()=>document.getElementById('recordBtn').className);
 ok('constructor failure falls back to default recorder',/recording/.test(st),st);
 await page.click('#recordBtn');await page.waitForTimeout(1500);
 ok('no page errors',errs.length===0,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
