const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/prompter-core.js'),'utf8'),ctx);
const C=ctx.VS.PrompterCore;let bad=0;const ok=(n,c,d)=>{if(!c)bad++;console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const script="Good evening and welcome to the news. Tonight, we cover the new bridge in Lagos, the price of rice, and the weather. First, the bridge: engineers say the new bridge will open in March, ahead of schedule. Next, rice prices fell for the second week.";
const W=C.words(script);
ok('words skip pure punctuation',C.words('a -- b').length===2);
ok('offsets slice back to the word',script.slice(W[3].start,W[3].end)==='welcome'||script.slice(W[2].start,W[2].end)==='welcome',[script.slice(W[2].start,W[2].end)]);
ok('norm strips punctuation/case/accents',C.norm('Café,')==='cafe'&&C.norm("Don't")==='dont');
// matching
let i=C.matchSpoken(W,'good evening and welcome',0);ok('start of script',i===4,i);
i=C.matchSpoken(W,'welcome to the news tonight we cover',4);ok('follows forward',i===C.words('Good evening and welcome to the news. Tonight, we cover').length,i);
i=C.matchSpoken(W,'the new bridge in lagos',4);ok('mid-script after skipping ahead',i===C.words('Good evening and welcome to the news. Tonight, we cover the new bridge in Lagos').length,i);
i=C.matchSpoken(W,'weather first the bridge',4);ok('jump 15 words ahead found',i!=null&&i>15,i);
ok('off-script chatter -> null',C.matchSpoken(W,'hey can you hear me okay',10)===null);
ok('single short word is ignored',C.matchSpoken(W,'the',10)===null);
ok('fuzzy: recogniser typo still matches',C.matchSpoken(W,'engineers say the new brige will open',20)!==null);
ok('empty spoken / empty script',C.matchSpoken(W,'',0)===null&&C.matchSpoken([],'hello there',0)===null);
const rep=C.words('go go go go stop now please go go go');ok('repeated words, no false jump',C.matchSpoken(rep,'go',0)===null);
const nums=C.words(Array.from({length:80},(_,k)=>'word'+k).join(' '));ok('exact beats fuzzy (word5 vs word52)',C.matchSpoken(nums,'word52 word53 word54',0)===55,C.matchSpoken(nums,'word52 word53 word54',0));
// vad
const st={on:false,lastLoud:-1e9};ok('silence stays off',C.vadStep(st,-70,0)===false);
ok('loud turns on',C.vadStep(st,-30,100)===true);ok('hold keeps on 500ms after',C.vadStep(st,-70,600)===true);ok('off after hold',C.vadStep(st,-70,900)===false);
ok('hysteresis: -45 does not start but keeps going',C.vadStep({on:false,lastLoud:-1e9},-45,0)===false&&C.vadStep({on:true,lastLoud:0},-45,2000)===true);
// pace
ok('pace 40 words in 20 s = 120 wpm',C.paceFromSample(40,20)===120);
ok('too short sample rejected',C.paceFromSample(5,2)===null&&C.paceFromSample(40,1)===null);
ok('clamped high/low',C.paceFromSample(100,10)===260&&C.paceFromSample(10,60)===60,[C.paceFromSample(100,10),C.paceFromSample(10,60)]);
ok('median',C.medianPace([100,200,150])===150&&C.medianPace([100,200])===150&&C.medianPace([])===null);
ok('px/s: 120 wpm, 100 words over 1000 px = 20',Math.abs(C.pxPerSecForWpm(120,100,1000)-20)<1e-9);
ok('px/s guards',C.pxPerSecForWpm(120,0,1000)===0);
const long=Array.from({length:80},(_,k)=>'word'+k+(k%10===9?'.':'')).join(' ');const sw=C.sampleWords(long,45);ok('sample cut at sentence end within 45 words',sw.count>=20&&sw.count<=45&&/\.$/.test(long.slice(0,sw.end)),sw);
// remote
ok('whitelist accepts known',C.parseRemoteCmd({type:'remote',cmd:'toggle'})==='toggle'&&C.parseRemoteCmd({type:'remote',cmd:'step-next'})==='step-next');
ok('rejects unknown / proto / wrong type',C.parseRemoteCmd({type:'remote',cmd:'constructor'})===null&&C.parseRemoteCmd({type:'remote',cmd:'__proto__'})===null&&C.parseRemoteCmd({type:'x',cmd:'toggle'})===null&&C.parseRemoteCmd(null)===null&&C.parseRemoteCmd({type:'remote',cmd:5})===null);
const rc=C.makeRoomCode([0,1,2,3,4,5,6,7]);ok('room code format',C.validRoom(rc),rc);ok('bad rooms rejected',!C.validRoom('rm-<b>')&&!C.validRoom('x')&&!C.validRoom(5));
ok('remote url',C.remoteUrl('https://a.netlify.app/studio.html?x=1#y','rm-abcdefgh')==='https://a.netlify.app/remote.html?room=rm-abcdefgh');
process.exit(bad?1:0);
