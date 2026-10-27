const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright'); const fs=require('fs'); const path=require('path');
const TV='/tmp/dl/tv/package', LG='/tmp/dl/legacy/package';
const MIME={'.js':'text/javascript','.wasm':'application/wasm','.tflite':'application/octet-stream','.binarypb':'application/octet-stream','.data':'application/octet-stream'};
function serve(route,file){ const ext=path.extname(file); return route.fulfill({status:200,body:fs.readFileSync(file),headers:{'content-type':MIME[ext]||'application/octet-stream','access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'}}); }
async function launch(opts={}){
  const video=opts.video||'/tmp/srv/fx/real.y4m';
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:(require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')?{executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'}:{})), args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+video,'--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport:opts.viewport||{width:1200,height:1000}, serviceWorkers:'block', permissions:['camera','microphone'] });
  await ctx.addInitScript(()=>{ localStorage.setItem('vs_users', JSON.stringify({'t@t.com':{name:'Tester',password:'x'}})); localStorage.setItem('vs_session', JSON.stringify({email:'t@t.com'})); });
  const log={routed:[],blocked:[]};
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route=>{
    const u=route.request().url();
    let m;
    if(/jsdelivr\.net\/npm\/@mediapipe\/tasks-vision(@[^/]*)?\/vision_bundle\.js/.test(u)) { log.routed.push('tasks bundle'); return serve(route,TV+'/vision_bundle.js'); }
    if((m=u.match(/tasks-vision(?:@[^/]*)?\/wasm\/([^?]+)/))) { log.routed.push('tasks wasm '+m[1]); return serve(route,TV+'/wasm/'+m[1]); }
    if((m=u.match(/selfie_segmentation(?:@[^/]*)?\/([^?]+)$/)) && /jsdelivr/.test(u)) { log.routed.push('legacy '+m[1]); return serve(route,LG+'/'+m[1]); }
    if(/storage\.googleapis\.com\/mediapipe-models\/.*selfie_segmenter_landscape/.test(u)) { log.routed.push('model landscape'); return serve(route,LG+'/selfie_segmentation_landscape.tflite'); }
    if(/storage\.googleapis\.com\/mediapipe-models\/.*selfie_segmenter\//.test(u)) { log.routed.push('model square'); return serve(route,LG+'/selfie_segmentation.tflite'); }
    log.blocked.push(u.slice(0,90)); return route.abort();
  });
  return { browser, ctx, log };
}
module.exports={launch};
