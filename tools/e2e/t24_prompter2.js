// M3 shot 5: teleprompter pace learning, follow-my-voice, follow-my-words (mock speech), phone remote over a REAL local signalling server.
const { launch } = require('./pwlib.js'); const { spawn } = require('child_process'); const path = require('path');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const SIG='ws://127.0.0.1:8799';
(async()=>{
 const srv=spawn('node',[path.join(__dirname,'../../server/signaling-server.js')],{env:Object.assign({},process.env,{PORT:'8799'}),stdio:'ignore'});
 await new Promise(r=>setTimeout(r,800));
 const {browser,ctx}=await launch();
 await ctx.route('**/js/config.js',r=>r.fulfill({contentType:'application/javascript',body:`window.VS=window.VS||{};window.VS.config={signalingUrl:'${SIG}'};`}));
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}
   window.SpeechRecognition=class{constructor(){window.__rec=this}start(){this.started=true}stop(){this.started=false}};});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 await page.click('#startBtn');await page.waitForFunction(()=>window.VS.audioChain&&window.VS.audioChain.ok!==false,null,{timeout:20000}).catch(()=>{});
 await page.click('.tool-tab[data-target="panel-prompter"]');
 const words=Array.from({length:120},(_,i)=>'word'+i+(i%12===11?'.':'')).join(' ');
 await page.fill('#prompterScript',words);await page.check('#prompterShow');
 // mic level control for tests: override the instance's peakDb
 const setLevel=(v)=>page.evaluate((v)=>{const c=window.VS.audioChain;Object.defineProperty(c,'peakDb',{get(){return v},set(){},configurable:true})},v);
 // 1. pace learning: loud for 12 s over a sample of N words
 await setLevel(-80);
 await page.click('#prompterLearn');const n0=await page.textContent('#prompterLearnNote');
 const sample=+(n0.match(/first (\d+) words/)||[])[1];ok('learn asks to read the first words',sample>=12&&sample<=45,n0);
 await setLevel(-20);await page.waitForTimeout(12000);await setLevel(-80);await page.click('#prompterLearn');
 const wpm=await page.evaluate(()=>window.VS.prompter.wpm);const want=sample/(12/60);
 ok('learned pace within 15% of truth',wpm&&Math.abs(wpm-want)/want<0.15,{wpm,want,sample});
 ok('note shows pace',/about \d+ words per minute/.test(await page.textContent('#prompterLearnNote')));
 // silent / too short sample is refused
 await page.click('#prompterLearn');await page.waitForTimeout(500);await page.click('#prompterLearn');
 ok('silent sample refused, pace unchanged',/could not measure/.test(await page.textContent('#prompterLearnNote'))&&(await page.evaluate(()=>window.VS.prompter.wpm))===wpm);
 // 2. follow my voice
 await page.selectOption('#prompterMode','voice');ok('mode voice',(await page.evaluate(()=>window.VS.prompter.mode))==='voice');
 await page.click('#prompterReset');await setLevel(-80);await page.click('#prompterToggle');await page.waitForTimeout(1500);
 const quiet=await page.evaluate(()=>window.VS.prompter.scrollTop);ok('silent: does not scroll',quiet<3,quiet);
 await setLevel(-20);await page.waitForTimeout(2000);const talk=await page.evaluate(()=>window.VS.prompter.scrollTop);ok('speaking: scrolls',talk>quiet+5,talk);
 await setLevel(-80);await page.waitForTimeout(1200);const a=await page.evaluate(()=>window.VS.prompter.scrollTop);await page.waitForTimeout(600);const b=await page.evaluate(()=>window.VS.prompter.scrollTop);
 ok('stops after you stop (hold 0.7 s)',Math.abs(a-b)<2,{a,b});
 await page.click('#prompterToggle');
 // 3. follow my words (mock recogniser)
 await page.selectOption('#prompterMode','words');await page.click('#prompterReset');await page.click('#prompterToggle');await page.waitForTimeout(300);
 ok('recogniser started',await page.evaluate(()=>!!(window.__rec&&window.__rec.started)));
 await page.evaluate(()=>window.__rec.onresult({resultIndex:0,results:[[{transcript:'word52 word53 word54'}]]}));await page.waitForTimeout(1500);
 const st=await page.evaluate(()=>{const box=document.getElementById('prompter'),body=document.getElementById('prompterBody');const t=body.firstChild,txt=t.data,i=txt.indexOf('word55');const r=document.createRange();r.setStart(t,i);r.setEnd(t,i+6);const rr=r.getBoundingClientRect(),br=box.getBoundingClientRect();return{idx:window.VS.prompter.wordIdx,top:box.scrollTop,rel:(rr.top-br.top)/br.height}});
 ok('word index jumped to 55',st.idx===55,st);ok('next word sits in the upper-middle of the box',st.rel>0&&st.rel<0.6&&st.top>100,st);
 await page.evaluate(()=>window.__rec.onresult({resultIndex:0,results:[[{transcript:'hello can you hear me'}]]}));await page.waitForTimeout(300);
 ok('off-script chatter ignored',(await page.evaluate(()=>window.VS.prompter.wordIdx))===55);
 await page.click('#prompterToggle');ok('recogniser stopped on pause',await page.evaluate(()=>window.__rec.started===false));
 // 4. phone remote
 await page.selectOption('#prompterMode','manual');await page.click('#prompterReset');
 await page.click('.tool-tab[data-target="panel-show"]').catch(()=>{});
 await page.click('#showCapture').catch(()=>{});await page.click('#showCapture').catch(()=>{});
 await page.click('.tool-tab[data-target="panel-prompter"]');
 await page.click('#remoteStart');await page.waitForTimeout(800);
 const room=await page.evaluate(()=>window.VS.PrompterRemote.room);ok('room code made',/^rm-[a-z0-9]{8}$/.test(room),room);
 ok('QR + link shown',await page.isVisible('#remoteQr')&&(await page.inputValue('#remoteLink')).includes('remote.html?room='+room));
 const rp=await ctx.newPage();await rp.setViewportSize({width:360,height:740});const rerrs=[];rp.on('pageerror',e=>rerrs.push(e.message));
 await rp.goto('http://127.0.0.1:8123/app/remote.html?room='+room);
 await rp.waitForFunction(()=>/Connected/.test(document.getElementById('st').textContent),null,{timeout:8000}).catch(()=>{});
 ok('remote says connected',/Connected/.test(await rp.textContent('#st')),await rp.textContent('#st'));
 ok('studio sees the remote',(await page.evaluate(()=>window.VS.PrompterRemote.peers))===1&&/connected/i.test(await page.textContent('#remoteStatus')));
 await rp.click('#bToggle');await page.waitForTimeout(400);ok('remote Start -> prompter plays',await page.evaluate(()=>window.VS.prompter.playing));
 await rp.waitForTimeout(1800);ok('remote button label follows state',/Pause/.test(await rp.textContent('#bToggle')),await rp.textContent('#bToggle'));
 await rp.click('#bToggle');await page.waitForTimeout(400);ok('remote Pause -> pauses',!(await page.evaluate(()=>window.VS.prompter.playing)));
 const s0=await page.evaluate(()=>window.VS.prompter.state.speed);await rp.click('[data-cmd=faster]');await page.waitForTimeout(300);
 ok('remote Faster +5',(await page.evaluate(()=>window.VS.prompter.state.speed))===s0+5);
 await rp.click('[data-cmd=lines-fwd]');await page.waitForTimeout(300);ok('remote forward 3 lines scrolls',(await page.evaluate(()=>window.VS.prompter.scrollTop))>50);
 const c0=await page.evaluate(()=>window.VS.Show.cur);await rp.click('#bNext');await page.waitForTimeout(400);
 const c1=await page.evaluate(()=>({cur:window.VS.Show.cur,n:window.VS.Show.cues.length}));ok('remote NEXT advances the Show',c1.n>=2&&c1.cur===c0+1,{c0,c1});
 // 360 px layout of the remote
 const lay=await rp.evaluate(()=>({sx:document.documentElement.scrollWidth>document.documentElement.clientWidth,minH:Math.min(...Array.from(document.querySelectorAll('button')).map(b=>b.getBoundingClientRect().height))}));
 ok('remote 360 px: no sideways scroll, buttons >= 44 px',!lay.sx&&lay.minH>=44,lay);
 // hostile peer: unknown commands ignored, flood limited
 const evil=await ctx.newPage();await evil.goto('http://127.0.0.1:8123/app/remote.html?room=rm-zzzzzzzz');
 const res=await evil.evaluate(({room,SIG})=>new Promise((resolve)=>{const ws=new WebSocket(SIG);ws.onopen=()=>ws.send(JSON.stringify({type:'join',room,name:'evil'}));
   ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.type==='joined'){const h=m.existingPeers.find(p=>p.name==='studio');if(!h)return resolve('no host');
     for(const c of ['constructor','__proto__','eval','toggle ','']){ws.send(JSON.stringify({type:'remote',cmd:c,to:h.id}))}
     ws.send(JSON.stringify({type:'nope',cmd:'toggle',to:h.id}));ws.send(JSON.stringify({type:'remote',cmd:{a:1},to:h.id}));
     for(let i=0;i<40;i++)ws.send(JSON.stringify({type:'remote',cmd:'faster',to:h.id}));setTimeout(()=>resolve('sent'),600)}}}),{room,SIG});
 const after=await page.evaluate(()=>({playing:window.VS.prompter.playing,speed:window.VS.prompter.state.speed}));
 ok('bad commands ignored, flood capped (<= 12 x +5)',res==='sent'&&!after.playing&&after.speed<=s0+5+60,{res,after,s0});
 // bad link
 const bad=await ctx.newPage();await bad.goto('http://127.0.0.1:8123/app/remote.html?room=<b>x');ok('invalid link explained',/not valid/.test(await bad.textContent('#st')));
 // off
 await page.click('#remoteStart');await page.waitForTimeout(500);ok('turn remote off',(await page.evaluate(()=>window.VS.PrompterRemote.room))===null);
 ok('no page errors',errs.length===0&&rerrs.length===0,{errs,rerrs});
 await browser.close();srv.kill();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
