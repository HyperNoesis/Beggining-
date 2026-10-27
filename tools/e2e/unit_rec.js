const vm=require('vm'),fs=require('fs');const c={window:{},document:{readyState:'complete',addEventListener(){},getElementById:()=>null},console};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../../js/rec-extras.js','utf8'),c);
const P=c.VS.RecExtras.pure;let bad=0;const t=(n,x)=>{if(!x)bad++;console.log((x?'PASS ':'FAIL ')+n)};
t('stamp 65 s = 1:05',P.stamp(65000)==='1:05');t('stamp 1 h = 1:00:00',P.stamp(3600000)==='1:00:00');t('stamp negative safe',P.stamp(-9)==='0:00');
let l=[];P.addMarker(l,5000);P.addMarker(l,5400);P.addMarker(l,9000);t('markers: double tap within 1 s dropped',l.length===2&&l[1].ms===9000);
t('marker garbage becomes 0',P.addMarker([],'x')[0].ms===0);
const big=[];for(let i=0;i<300;i++)P.addMarker(big,i*2000);t('capped at 200',big.length===200);
t('chapters start at 0:00 for YouTube',P.chaptersText([{ms:65000,label:'Marker 1'}])==='0:00 Start\n1:05 Marker 1');
t('chapters with a marker at 0 do not duplicate',P.chaptersText([{ms:0,label:'a'},{ms:3000,label:'b'}])==='0:00 Start\n0:03 b');
t('mp4 report',/MP4/.test(P.formatReport('video/mp4;codecs=avc1',true)));
t('webm report warns about iPhone/WhatsApp',/iPhone/.test(P.formatReport('video/webm;codecs=vp9',false))&&/cannot record MP4/.test(P.formatReport('video/webm',false)));
t('unknown format is honest',/did not say/.test(P.formatReport('',false)));
t('audio mime picks first supported',P.pickAudioMime({isTypeSupported:(m)=>m==='audio/webm'})==='audio/webm'&&P.pickAudioMime({isTypeSupported:()=>false})==='');
process.exit(bad?1:0)
