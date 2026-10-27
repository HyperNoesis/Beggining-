const vm=require('vm'),fs=require('fs');const c={window:{},document:{},console};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../../js/audio-chain.js','utf8'),c);
const D=c.VS.AudioPresets.duckStep;let bad=0;const t=(n,x)=>{if(!x)bad++;console.log((x?'PASS ':'FAIL ')+n)};
let s={lastVoiceAt:null};
t('silence: no duck, gain 1',(r=>!r.active&&r.gain===1)(D(s,-70,0)));
t('voice above threshold ducks 12 dB (0.251)',(r=>r.active&&Math.abs(r.gain-0.251)<0.01)(D(s,-20,100)));
t('still ducked inside hold time after voice stops',D(s,-70,500).active);
t('releases after hold',!D(s,-70,700).active&&D(s,-70,700).gain===1);
t('noise below threshold does not duck',!D({lastVoiceAt:null},-50,0).active);
t('amount 24 dB',Math.abs(D({lastVoiceAt:null},-10,0,{amountDb:24}).gain-0.0631)<0.002);
t('amount clamped to 40 dB, negative to 0',D({lastVoiceAt:null},-10,0,{amountDb:99}).gain<0.0101&&D({lastVoiceAt:null},-10,0,{amountDb:-5}).gain===1);
t('-Infinity peak is safe',!D({lastVoiceAt:null},-Infinity,0).active);
process.exit(bad?1:0)
