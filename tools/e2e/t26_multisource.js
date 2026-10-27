// M3 shot 7: second phone as a camera, over a REAL local signalling server + REAL WebRTC between two pages.
const { launch } = require('./pwlib.js'); const { spawn, execSync } = require('child_process'); const path = require('path'), fs = require('fs');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const SIG='ws://127.0.0.1:8798',OUT=process.env.GENESIS_OUT||'/tmp';
(async()=>{
 const srv=spawn('node',[path.join(__dirname,'../../server/signaling-server.js')],{env:Object.assign({},process.env,{PORT:'8798'}),stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
 const {browser,ctx}=await launch();
 await ctx.route('**/js/config.js',r=>r.fulfill({contentType:'application/javascript',body:`window.VS=window.VS||{};window.VS.config={signalingUrl:'${SIG}'};`}));
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');await page.click('#startBtn');await page.waitForTimeout(2500);
 await page.click('.tool-tab[data-target="panel-content"]');
 // frame grab of the top-right corner (where the picture-in-picture box sits)
 const corner=()=>page.evaluate(async()=>{const c=document.getElementById('canvas');const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(10);await v.play();await new Promise(r=>setTimeout(r,1200));const o=document.createElement('canvas');o.width=v.videoWidth;o.height=v.videoHeight;const x=o.getContext('2d');x.drawImage(v,0,0);const w=o.width,h=o.height;const d=x.getImageData(Math.round(w*.66),0,Math.round(w*.34),Math.round(h*.4)).data;return {d:Array.from(d.filter((_,i)=>i%4<3&&(i>>2)%7===0)),png:o.toDataURL('image/png')}});
 const diff=(a,b)=>{let s=0,n=Math.min(a.length,b.length);for(let i=0;i<n;i++)s+=Math.abs(a[i]-b[i]);return s/n};
 const base=await corner();
 // 1. link + QR
 await page.click('#camStart');await page.waitForTimeout(800);
 const link=await page.inputValue('#camLink');ok('link is a cam.html room link',/cam\.html\?room=rm-[a-z0-9]{8}$/.test(link),link);
 const qrPng=await page.evaluate(()=>document.getElementById('camQr').toDataURL('image/png'));fs.writeFileSync(OUT+'/t26_qr.png',Buffer.from(qrPng.split(',')[1],'base64'));
 let dec='';try{dec=execSync(`python3 -c "import cv2;i=cv2.imread('${OUT}/t26_qr.png');print(cv2.QRCodeDetector().detectAndDecode(i)[0])"`).toString().trim()}catch(e){}
 ok('QR on screen decodes (OpenCV) to the same link',dec===link,dec);
 ok('status says waiting',/Waiting for a phone/.test(await page.textContent('#camStatus')));
 // 2. bad messages are ignored (raw socket pretending to be a camera)
 const room=link.split('room=')[1];
 await page.evaluate(({SIG,room})=>new Promise(res=>{const w=new WebSocket(SIG);w.onopen=()=>w.send(JSON.stringify({type:'join',room,name:'cam'}));w.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.type==='joined'){const to=(m.existingPeers.find(p=>p.name==='studio')||{}).id;for(const bad of [{type:'rcam-offer',sdp:'junk'},{type:'rcam-offer',sdp:{x:1}},{type:'remote',cmd:'toggle'},{type:'rcam-ice',candidate:'zz'},{type:'rcam-answer',sdp:'v=0'}])w.send(JSON.stringify(Object.assign({to},bad)));setTimeout(()=>{w.close();res()},500)}}}),{SIG,room});
 ok('junk offers never show an Accept box',(await page.evaluate(()=>document.getElementById('camPending').style.display))==='none');
 // 3. camera phone page
 const cam=await ctx.newPage();cam.on('pageerror',e=>errs.push('cam:'+e.message));
 await cam.goto(link);await cam.click('#bStart');await page.waitForFunction(()=>document.getElementById('camPending').style.display==='flex',null,{timeout:15000}).catch(()=>{});
 ok('studio asks before accepting',(await page.evaluate(()=>document.getElementById('camPending').style.display))==='flex'&&/wants to join/.test(await page.textContent('#camPendingText')),await page.textContent('#camPendingText'));
 ok('nothing is shown before Accept',(await page.evaluate(()=>window.VS.sourceApi.count))===0);
 // 4. decline
 await page.click('#camDecline');await cam.waitForFunction(()=>/declined/.test(document.getElementById('st').textContent),null,{timeout:8000}).catch(()=>{});
 ok('decline is told to the camera phone',/declined/.test(await cam.textContent('#st')),await cam.textContent('#st'));
 ok('declined: still no overlay',(await page.evaluate(()=>window.VS.sourceApi.count))===0);
 // 5. try again and accept
 await cam.click('#bStop');await cam.click('#bStart');await page.waitForFunction(()=>document.getElementById('camPending').style.display==='flex',null,{timeout:15000}).catch(()=>{});
 await page.click('#camAccept');
 await cam.waitForFunction(()=>window.__cam&&window.__cam.state==='connected',null,{timeout:25000}).catch(()=>{});
 ok('WebRTC connected between the two pages',(await cam.evaluate(()=>window.__cam.state))==='connected');
 await page.waitForFunction(()=>window.VS.sourceApi.count===1,null,{timeout:10000}).catch(()=>{});
 ok('studio has the phone camera as an overlay',(await page.evaluate(()=>window.VS.sourceApi.count))===1&&/Phone camera/.test(await page.textContent('#overlayList')));
 ok('status says 1 connected',/1 phone camera connected/.test(await page.textContent('#camStatus')),await page.textContent('#camStatus'));
 await page.waitForTimeout(1500);const on=await corner();fs.writeFileSync(OUT+'/t26_on.png',Buffer.from(on.png.split(',')[1],'base64'));
 ok('picture-in-picture really appears in the OUTPUT frame',diff(base.d,on.d)>2,diff(base.d,on.d));
 // 6. layouts
 for(const l of ['sidebyside','bubble','cutout','default']){await page.click(`#camLayouts [data-l="${l}"]`);ok('layout '+l,(await page.inputValue('#layoutModeSelect'))===l)}
 // 7. flip camera button keeps connection
 await cam.click('#bFlip');await cam.waitForTimeout(1500);ok('switch camera keeps the link',(await cam.evaluate(()=>window.__cam.state))==='connected');
 // 8. phone stops -> overlay goes
 await cam.click('#bStop');await page.waitForFunction(()=>window.VS.sourceApi.count===0,null,{timeout:8000}).catch(()=>{});
 ok('phone Stop removes the overlay',(await page.evaluate(()=>window.VS.sourceApi.count))===0&&(await page.evaluate(()=>window.VS.MultiSource.peers))===0);
 // 9. reconnect + Remove in the studio list tells the phone
 await cam.click('#bStart');await page.waitForFunction(()=>document.getElementById('camPending').style.display==='flex',null,{timeout:15000}).catch(()=>{});await page.click('#camAccept');
 await page.waitForFunction(()=>window.VS.sourceApi.count===1,null,{timeout:15000}).catch(()=>{});
 await page.click('#overlayList .ov-remove');await page.waitForTimeout(800);
 ok('Remove in studio list drops the peer',(await page.evaluate(()=>window.VS.MultiSource.peers))===0&&(await page.evaluate(()=>window.VS.sourceApi.count))===0);
 // 10. screen share still works through the shared function (mock display capture)
 await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');setInterval(()=>{x.fillStyle='#c33';x.fillRect(0,0,320,180)},50);return c.captureStream(10)}});
 await page.click('#contentUploadScreenTrigger');await page.waitForFunction(()=>window.VS.sourceApi.count===1,null,{timeout:8000}).catch(()=>{});
 ok('screen share still adds an overlay',(await page.evaluate(()=>window.VS.sourceApi.count))===1);
 await page.click('#overlayList .ov-remove');
 // 11. turning it off
 await page.click('#camStart');ok('Turn off hides link and QR',(await page.evaluate(()=>document.getElementById('camQr').style.display))==='none'&&(await page.evaluate(()=>document.getElementById('camLink').style.display))==='none');
 // 12. bad link page + 360px layout
 const bad=await ctx.newPage();await bad.setViewportSize({width:360,height:740});await bad.goto('http://127.0.0.1:8123/app/cam.html?room=nope');
 ok('bad link: plain message, Start disabled',/not valid/.test(await bad.textContent('#st'))&&(await bad.evaluate(()=>document.getElementById('bStart').disabled)));
 await bad.goto(link);const lay=await bad.evaluate(()=>({sx:document.documentElement.scrollWidth>document.documentElement.clientWidth,minH:Math.min(...Array.from(document.querySelectorAll('button')).map(b=>b.getBoundingClientRect().height))}));
 ok('cam page at 360 px: no sideways scroll, buttons >= 44 px',!lay.sx&&lay.minH>=44,lay);
 const sl=await page.evaluate(()=>{const b=document.querySelectorAll('#camSection button');return Math.min(...Array.from(b).map(x=>x.getBoundingClientRect().height).filter(h=>h>0))});ok('studio section buttons >= 44 px',sl>=44,sl);
 ok('no page errors',errs.length===0,errs.slice(0,3));
 await browser.close();srv.kill();console.log(R.every(Boolean)?'ALL PASS':'SOME FAILED ('+R.filter(x=>!x).length+')');process.exit(R.every(Boolean)?0:1);
})();
