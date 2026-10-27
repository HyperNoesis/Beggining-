const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
(async()=>{const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});const p=await(await b.newContext({viewport:{width:360,height:740}})).newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8123/app/blindtest.html');
const dir='/home/claude/work/assets/environments/';const real=['classroom','newsroom','outdoor'].map(n=>dir+n+'.jpg'),virt=['scene-news-desk','scene-terrace','scene-library-warm'].map(n=>dir+n+'.jpg');
await p.setInputFiles('#addReal',real);await p.setInputFiles('#addVirtual',virt);
ok('items counted',/3 real, 3 virtual/.test(await p.textContent('#itemCount')));
ok('start disabled without a name',await p.isDisabled('#start'));
await p.fill('#viewerName','V1');ok('start enabled with a name',!(await p.isDisabled('#start')));
for(let v=0;v<2;v++){ if(v>0){await p.click('#another');await p.fill('#viewerName','V'+(v+1));}
 await p.click('#start');for(let i=0;i<6;i++){ok&&0;await p.click('#sayReal');}
 ok('viewer '+(v+1)+' finished and saved',await p.isVisible('#done'));}
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('vs_blindtest_results')));
ok('2 sessions of 6 answers saved',saved.length===2&&saved.every(s=>s.answers.length===6));
ok('verdict says not enough viewers',/not a result/.test(await p.textContent('#verdict')),await p.textContent('#verdict'));
ok('all-real answers => did not notice, table shows it',(await p.textContent('#tbl')).includes('yes'));
ok('no sideways scroll at 360px',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
ok('no page errors',errs.length===0,errs);await b.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
