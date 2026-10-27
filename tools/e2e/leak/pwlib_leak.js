const { chromium } = require('playwright');
const ARGS = ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl',
  '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+(process.env.GENESIS_FX||'/tmp/srv/fx')+'/person.y4m',
  '--autoplay-policy=no-user-gesture-required'];
async function launch(){
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:(require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')?{executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'}:{})), args: ARGS });
  const ctx = await browser.newContext({ viewport:{width:1200,height:1000}, serviceWorkers:'block', permissions:['camera','microphone'] });
  await ctx.addInitScript(()=>{
    localStorage.setItem('vs_users', JSON.stringify({'t@t.com':{name:'Tester',password:'x'}}));
    localStorage.setItem('vs_session', JSON.stringify({email:'t@t.com'}));
  });
  return { browser, ctx };
}
// Injected "model": a SOFT, LOW-RES mask derived from the exact ground truth (what a real segmenter roughly gives).
const FAKE_PROVIDER = `
(() => {
  const gtImg = new Image(); window.__gtReady = new Promise(r => { gtImg.onload = r; gtImg.src = '/fx/gt_alpha.png'; });
  class FakeSeg {
    constructor(){ this.label='FakeModel (test, soft 256px mask)'; this.costPerFrame=0; this.lowLightBoost=true; this.backend='tasks'; this.lastBoostApplied=false;
      this.c=document.createElement('canvas'); this.g=document.createElement('canvas'); this.x=this.c.getContext('2d'); this.gx=this.g.getContext('2d',{willReadFrequently:true}); }
    async initialize(){ await window.__gtReady; }
    async segment(video){
      const sw=window.__maskW||256, sh=Math.round(sw*gtImg.naturalHeight/gtImg.naturalWidth);
      this.g.width=sw; this.g.height=sh; this.c.width=sw; this.c.height=sh;
      this.gx.imageSmoothingQuality='high'; this.gx.filter='blur('+(window.__maskBlur||1.2)+'px)';
      this.gx.drawImage(gtImg,0,0,sw,sh); this.gx.filter='none'; if(${process.env.LEAK||0}){ this.gx.fillStyle='#fff'; this.gx.fillRect(sw*0.0,sh*0.30,sw*0.12,sh*0.70); this.gx.fillRect(sw*0.88,sh*0.30,sw*0.12,sh*0.70); }
      const d=this.gx.getImageData(0,0,sw,sh), o=this.x.createImageData(sw,sh);
      for(let i=0;i<sw*sh;i++){ o.data[i*4]=255;o.data[i*4+1]=255;o.data[i*4+2]=255;o.data[i*4+3]=d.data[i*4]; }
      this.x.putImageData(o,0,0);
      return { segmentationMask: this.c };
    }
    dispose(){}
  }
  window.VS.MediaPipeSegmentationProvider = FakeSeg;
})();`;
module.exports = { launch, FAKE_PROVIDER };
