const fs=require('fs'),vm=require('vm'),path=require('path');
const ctx={window:{},document:{}};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/audio-chain.js'),'utf8'),ctx);
const P=ctx.VS.AudioPresets;let bad=0;const t=(n,c)=>{if(!c)bad++;console.log((c?'PASS ':'FAIL ')+n)};
t('3 presets',Object.keys(P.PRESETS).length===3);
['voice','podcast'].forEach(k=>{const p=P.PRESETS[k];t(k+': 3 EQ bands',p.eq.length===3);t(k+': hpf sane',p.hpf>=40&&p.hpf<=150);t(k+': comp ratio 2-6, threshold < 0',p.comp.ratio>=2&&p.comp.ratio<=6&&p.comp.threshold<0);t(k+': makeup 0-9 dB',p.makeup>=0&&p.makeup<=9);t(k+': eq gains within +-6 dB',p.eq.every(b=>Math.abs(b[2])<=6))});
t('quiet note',/quiet/i.test(P.loudnessNote(-30,-16)));t('loud note',/loud/i.test(P.loudnessNote(-8,-16)));t('good note',/good/i.test(P.loudnessNote(-16,-16)));t('no signal note',/Speak/.test(P.loudnessNote(null,-16)));t('raw mic note',/Raw/.test(P.loudnessNote(-20,null)));
t('db of 1 = 0',P.dbFromLinear(1)===0);t('db of 0 = -inf',P.dbFromLinear(0)===-Infinity);
process.exit(bad?1:0);
