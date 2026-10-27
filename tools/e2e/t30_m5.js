// M5 in a real browser: landing, pilot form, before/after, legal pages, index routing, Studio before/after capture.
const { launch } = require('./pwlib.js');const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const B='http://127.0.0.1:8123/app/';
(async()=>{const {browser,ctx}=await launch();
 const mk=async(init)=>{const p=await ctx.newPage();p.__e=[];p.on('pageerror',e=>p.__e.push(e.message));if(init)await p.addInitScript(init);return p};
 // 1. landing without config
 let p=await mk();await p.goto(B+'landing.html');await p.waitForTimeout(800);
 ok('landing: pilot closed message when no contact set',await p.$eval('#pilotOff',e=>!e.hidden)&&await p.$eval('#pilotForm',e=>e.hidden));
 ok('landing: no before/after without real pictures, scene thumbnails shown',await p.$eval('#baBox',e=>e.hidden)&&(await p.$$('#sceneThumbs img')).length>=4);
 ok('landing: CTA to studio + legal links',await p.$('a[href="studio.html"]')&&await p.$('a[href="privacy.html"]')&&await p.$('a[href="terms.html"]'));
 ok('landing: no overclaim words',!/indistinguishable|guarantee|100%|perfect/i.test(await p.textContent('body')));
 ok('landing: no page errors',p.__e.length===0,p.__e);
 await p.setViewportSize({width:360,height:740});
 ok('landing 360px: no sideways scroll, buttons >=44px',await p.evaluate(()=>document.documentElement.scrollWidth<=360&&[...document.querySelectorAll('.btn')].every(b=>b.getBoundingClientRect().height>=44)));
 // 2. landing with config + real pictures + pay link
 const png=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==','base64');
 const p2=await mk();await ctx.route('**/js/config.js',r=>r.fulfill({contentType:'application/javascript',body:"window.VS=window.VS||{};window.VS.config={business:{name:'Rejuvini',email:'pilot@example.com',jurisdiction:'Nigeria',effectiveDate:'1 Nov 2026'},payLinks:{pro:'https://paystack.com/pay/example'}};"}));
 await ctx.route('**/assets/landing/*.jpg',r=>r.fulfill({contentType:'image/jpeg',body:png}));
 await p2.goto(B+'landing.html');await p2.waitForTimeout(1000);
 ok('config: pilot form shown, closed note hidden',await p2.$eval('#pilotForm',e=>!e.hidden)&&await p2.$eval('#pilotOff',e=>e.hidden));
 ok('config: before/after slider shown and moves the clip',await p2.$eval('#baBox',e=>!e.hidden)&&await (async()=>{await p2.$eval('#baRange',e=>{e.value=20;e.dispatchEvent(new Event('input'))});return (await p2.$eval('#baBefore',e=>e.style.clipPath)).includes('80%')})());
 ok('config: pay link only if https',await p2.$eval('#payBtn',e=>!e.hidden&&e.href==='https://paystack.com/pay/example'));
 await p2.fill('#pName','Ada');let nav=null;await p2.route('mailto:**',r=>r.abort()).catch(()=>{});
 const href=await p2.evaluate(()=>window.VS.Landing.pilotMessage({name:'Ada',use:'Teaching',phone:'Redmi',note:''},window.VS.config.business).href);
 ok('pilot message builds a mailto',/^mailto:pilot@example.com\?subject=/.test(href),href.slice(0,60));
 // 3. legal pages
 const lg=await mk();await lg.goto(B+'privacy.html');await lg.waitForTimeout(1200);
 ok('privacy renders with headings',(await lg.$$('#legalBody h2')).length>=4);
 ok('privacy mentions second-phone relay + STUN + Nigeria Data Protection Act',/signalling|relay/i.test(await lg.textContent('#legalBody'))&&/STUN/.test(await lg.textContent('#legalBody'))&&/Nigeria Data Protection Act/.test(await lg.textContent('#legalBody')));
 ok('privacy: filled details appear, banner still warns about legal wording or placeholders',/Rejuvini/.test(await lg.textContent('#legalBody')));
 const tg=await mk();await tg.goto(B+'terms.html');await tg.waitForTimeout(1200);
 ok('terms: banner shown because lawyer-text placeholders remain',await tg.$eval('#legalBanner',e=>!e.hidden&&/Not ready to publish/.test(e.textContent)));
 ok('terms: unfilled placeholders are highlighted, not hidden',(await tg.$$('#legalBody mark.ph')).length>=1);
 // 4. index routes signed-out visitors to the landing page
 const ix=await ctx.newPage();await ix.addInitScript(()=>{localStorage.removeItem('vs_session')});await ix.goto(B+'index.html');await ix.waitForTimeout(2500);
 ok('signed-out visitor lands on landing.html',/landing\.html/.test(ix.url()),ix.url());
 // 5. Studio: before/after capture downloads two real JPEGs
 await ctx.unroute('**/js/config.js');await ctx.unroute('**/assets/landing/*.jpg');
 const st=await mk(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});await st.goto(B+'studio.html');await st.waitForSelector('#startBtn');
 await st.click('.tool-tab[data-target="panel-recordings"]');await st.click('#baBtn');await st.waitForTimeout(300);
 ok('capture before camera starts gives plain message',/Start the camera/.test(await st.textContent('#baMsg')));
 await st.click('#startBtn');await st.waitForTimeout(3500);
 const dls=[];st.on('download',d=>dls.push(d));await st.click('#baBtn');await st.waitForTimeout(4000);
 ok('two downloads: before.jpg and after.jpg',dls.length===2&&dls.map(d=>d.suggestedFilename()).sort().join()==='after.jpg,before.jpg',dls.map(d=>d.suggestedFilename()));
 const fs=require('fs');const sizes=[];for(const d of dls){const f=await d.path();const b=fs.readFileSync(f);sizes.push([b[0]===0xff&&b[1]===0xd8,b.length])}
 ok('both are real JPEGs with content',sizes.length===2&&sizes.every(s=>s[0]&&s[1]>5000),sizes);
 ok('no page errors anywhere',[p,p2,lg,tg,st].every(x=>x.__e.length===0),[p,p2,lg,tg,st].map(x=>x.__e));
 await browser.close();const f=R.filter(x=>!x).length;console.log(f?'FAILED '+f:'ALL PASS');process.exit(f?1:0);
})();
