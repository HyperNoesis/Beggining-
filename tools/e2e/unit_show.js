// Show Conductor core + graphics applySpec (pure logic, no browser)
const vm=require('vm'),fs=require('fs'),path=require('path');
let bad=0;const t=(n,c,d)=>{if(!c)bad++;console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const root=path.join(__dirname,'../../js/');
// ---- ShowCore
{const ctx={window:{}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'show-core.js','utf8'),ctx);const C=ctx.VS.ShowCore;
 const good={label:'Intro',say:'Smile',gfx:{lt:{mode:'show',name:'John',title:'Host',accent:'Red',template:'bold',secs:6},banner:{mode:'hide'}},look:'news'};
 const n=C.normaliseCue(good);t('keeps good cue',n.label==='Intro'&&n.gfx.lt.template==='bold'&&n.gfx.lt.secs===6&&n.gfx.banner.mode==='hide'&&n.look==='news');
 const evil=C.normaliseCue({label:'x'.repeat(500),gfx:{lt:{mode:'show',name:'a'.repeat(999),accent:'Pink',template:'<script>',secs:99999},card:{mode:'explode'},countdown:{mode:'show',seconds:-5}},look:{a:1},__proto__:{z:1}});
 t('clamps/ignores junk',evil.label.length===60&&evil.gfx.lt.name.length===60&&evil.gfx.lt.accent===undefined&&evil.gfx.lt.template===undefined&&evil.gfx.lt.secs===600&&!evil.gfx.card&&evil.gfx.countdown.seconds===1&&!evil.look,evil);
 t('null/number rejected',C.normaliseCue(null)===null&&C.normaliseCue(5)===null);
 t('empty label gets a name',C.normaliseCue({}).label==='Step');
 const rt=C.parse(C.serialise([n,C.normaliseCue({label:'B'})]));t('round trip',rt.ok&&rt.cues.length===2&&rt.cues[0].gfx.lt.name==='John'&&rt.error==='');
 t('bad json is a plain error',!C.parse('{nope').ok&&/does not look like a show/.test(C.parse('{nope').error));
 t('empty text error',!C.parse('').ok&&!C.parse(null).ok);
 t('no cues key error',!C.parse('{"a":1}').ok);
 t('newer version refused',!C.parse('{"v":99,"cues":[]}').ok&&/newer version/.test(C.parse('{"v":99,"cues":[]}').error));
 t('bare array accepted',C.parse('[{"label":"A"}]').ok);
 const many=JSON.stringify({v:1,cues:Array.from({length:80},(_,i)=>({label:'s'+i}))});const pm=C.parse(many);t('caps at 60 and reports',pm.cues.length===60&&/20 steps were skipped/.test(pm.error),pm.error);
 t('oversize refused',!C.parse(' '.repeat(300000)+'{}').ok);
 const dup=C.parse(JSON.stringify({v:1,cues:[{id:'a',label:'1'},{id:'a',label:'2'}]}));t('duplicate ids fixed',dup.cues[0].id!==dup.cues[1].id);
 t('step next',C.step(-1,3,'next')===0&&C.step(1,3,'next')===2&&C.step(2,3,'next')===null);
 t('step back',C.step(2,3,'back')===1&&C.step(0,3,'back')===null&&C.step(-1,3,'back')===null);
 t('step with empty show',C.step(-1,0,'next')===null&&C.step(-1,0,'back')===null);
 t('describe',(()=>{const d=C.describe([{label:'A',say:'hi'},{label:'B',say:''}],0);return d.now==='A'&&d.next==='B'&&d.say==='hi'&&!d.atEnd&&d.position==='Step 1 of 2'})());
 t('describe end + not started',C.describe([{label:'A'}],0).atEnd&&/Not started/.test(C.describe([{label:'A'}],-1).position)&&C.describe([],-1).position==='No steps yet');
 t('summarise',/Lower third: John/.test(C.summarise(n))&&/Hide banner/.test(C.summarise(n))&&C.summarise(C.normaliseCue({label:'x'}))==='No changes yet');
 t('replayGfx drops timed parts of earlier steps',(()=>{const cs=[{gfx:{lt:{mode:'show',name:'A',secs:5},countdown:{mode:'show',seconds:60},card:{mode:'show',title:'x'}}},{gfx:{card:{mode:'hide'}}},{gfx:{lt:{mode:'show',name:'B',secs:5},countdown:{mode:'show',seconds:9}}}];const r=C.replayGfx(cs,2);return r.length===3&&!r[0].lt&&!r[0].countdown&&r[0].card.mode==='show'&&r[1].card.mode==='hide'&&r[2].lt.name==='B'&&r[2].countdown.seconds===9&&C.replayGfx(cs,0)[0].lt.secs===5&&cs[0].gfx.lt&&C.replayGfx(cs,99).length===3})());
 t('move',C.move([1,2,3],0,1).join()==='2,1,3'&&C.move([1,2,3],0,-1).join()==='1,2,3'&&C.move([1,2,3],2,1).join()==='1,2,3');
}
// ---- Graphics pure + applySpec (stub DOM: nothing is drawn)
{const c2d=new Proxy({},{get:(o,k)=>k in o?o[k]:(k==='measureText'?(x)=>({width:String(x).length*10}):(k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}) ),set:(o,k,v)=>{o[k]=v;return true}});const el=()=>({getContext:()=>c2d,width:0,height:0,addEventListener(){}});let now=1000;
 const timers=[];const ctx={window:{},document:{readyState:'complete',createElement:el,getElementById:()=>null,addEventListener(){}},localStorage:{store:{},getItem(k){return this.store[k]||null},setItem(k,v){this.store[k]=v}},performance:{now:()=>now},setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length},clearTimeout(){},createImageBitmap:()=>Promise.resolve({})};ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(root+'qr.js','utf8'),ctx);vm.runInContext(fs.readFileSync(root+'graphics.js','utf8'),ctx);
 // kick() calls draw() which needs a real 2D context; stub only what is needed by replacing the canvas context after load is not possible, so check pure parts + state through try/catch
 const G=ctx.VS.Graphics,P=G.pure;
 t('countdown text',P.countdownText(125000)==='02:05'&&P.countdownText(0)==='00:00'&&P.countdownText(1)==='00:01'&&P.countdownText(3725000)==='1:02:05'&&P.countdownText(-50)==='00:00');
 const m=(s)=>s.length*10;
 t('wrap simple',JSON.stringify(P.wrapLines(m,'aa bb cc dd',50,5))==='["aa bb","cc dd"]',P.wrapLines(m,'aa bb cc dd',50,5));
 t('wrap ellipsis at max lines',(()=>{const r=P.wrapLines(m,'aa bb cc dd ee ff',50,2);return r.length===2&&/…$/.test(r[1])})(),P.wrapLines(m,'aa bb cc dd ee ff',50,2));
 t('wrap cuts long word',(()=>{const r=P.wrapLines(m,'abcdefghijklmnop',50,5);return r.length>=3&&r.every((x)=>m(x)<=50)})());
 t('wrap empty',P.wrapLines(m,'',50,3).length===0);
 t('4 templates',G.TEMPLATES.length===4);
 // applySpec: stub draw so no canvas is needed
 const calls=[];
 const run=(sp)=>{try{G.applySpec(sp)}catch(e){calls.push('ERR '+e.message)}};
 run({lt:{mode:'show',name:'Ada',title:'Host',accent:'Gold',template:'glass',secs:4}});
 t('applySpec shows lt with style',G.isOn('lt')&&G.state.lt.name==='Ada'&&G.state.lt.template==='glass'&&G.state.lt.accent==='Gold'&&calls.length===0,calls);
 t('lt auto-hide timer set to 4 s',timers.some((x)=>x.ms===4000));
 run({lt:{mode:'hide'}});t('applySpec hides lt',!G.isOn('lt'));
 run({banner:{mode:'show',label:'ALERT',text:'Hi'},card:{mode:'show',title:'BRB',sub:'soon',accent:'Red',qr:'https://x.co'}});
 t('banner + card on',G.isOn('banner')&&G.isOn('card')&&G.state.banner.label==='ALERT'&&G.state.card.qr==='https://x.co');
 now=5000;run({card:{mode:'hide'}});t('card off',!G.isOn('card')&&G.isOn('banner'));
 run({countdown:{mode:'show',seconds:90,label:'Soon'}});t('countdown running',G.isOn('countdown')&&G.state.countdown.endAt===5000+90000);
 run({countdown:{mode:'hide'}});t('countdown stopped',!G.isOn('countdown'));
 run({ticker:{mode:'show',text:'News!'},social:{mode:'show',text:'@me'},qr:{mode:'show',text:'https://a.b',caption:'Scan'},bug:{mode:'show',text:'CH1',logo:true}});
 t('ticker/social/qr/bug on',G.isOn('ticker')&&G.state.ticker.text==='News!'&&G.isOn('social')&&G.isOn('qr')&&G.isOn('bug'));
 run({});run(null);run({lt:{}});t('empty spec changes nothing',G.isOn('ticker')&&!G.isOn('lt'));
 run({lt:{mode:'show',template:'nope',accent:'nope',name:'x'.repeat(500)}});t('bad template/accent ignored, name clamped',G.state.lt.template==='glass'&&G.state.lt.name.length===60);
 G.clearAll();t('clearAll',!G.isOn('ticker')&&!G.isOn('social')&&!G.isOn('qr')&&!G.isOn('bug')&&!G.isOn('banner'));
 t('persisted ext',/"ext"/.test(ctx.localStorage.store.vs_gfx||'')&&/glass/.test(ctx.localStorage.store.vs_gfx));
}
process.exit(bad?1:0);
