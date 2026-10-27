const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={window:{},document:{readyState:'complete',getElementById:()=>null,addEventListener(){}},localStorage:{}};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/teleprompter.js'),'utf8'),ctx);
const T=ctx.VS.Teleprompter;let bad=0;const t=(n,g,w)=>{const ok=Math.abs(g-w)<1e-9;if(!ok)bad++;console.log((ok?'PASS ':'FAIL ')+n+' -> '+g)};
t('moves speed*dt',T.scrollStep(0,40,500,1000),20);t('clamps at max',T.scrollStep(990,40,1000,1000),1000);t('never below 0',T.scrollStep(0,-40,1000,100),0);
t('150 words at 150wpm = 1 min',T.estimateMinutes('word '.repeat(150),150),1);t('empty text',T.estimateMinutes('   ',150),0);
process.exit(bad?1:0);
