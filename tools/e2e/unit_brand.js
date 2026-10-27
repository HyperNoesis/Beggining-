// Brand kit pure logic: palette from logo pixels, contrast helpers, scoreboard clock text, Show cue validation for score + Brand accent.
const B = require('../../js/brand-core.js'); const vm = require('vm'), fs = require('fs'), path = require('path');
let bad = 0; const t = (n, c, d) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); };
// synthetic logos (RGBA)
function img(w, h, fn) { const a = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y) || [0, 0, 0, 0]; a.set(c.length === 3 ? [...c, 255] : c, (y * w + x) * 4); } return a; }
const W = 100, H = 100, hex = B.rgbToHex;
// 1. red disc on transparent: primary is red
let r = B.extractPalette(img(W, H, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 1600 ? [220, 30, 40] : null)), W, H);
t('red logo -> ok, primary is red', r.ok && B.hexToRgb(r.primary)[0] > 190 && B.hexToRgb(r.primary)[1] < 70, r);
t('single-colour logo gets a darker second colour', r.ok && !r.secondaryFromLogo && B.contrast(r.secondary, '#ffffff') > B.contrast(r.primary, '#ffffff'));
// 2. two colours: big blue + small orange -> primary blue, secondary orange
r = B.extractPalette(img(W, H, (x, y) => (y < 70 ? [30, 90, 230] : y < 90 ? [250, 140, 20] : [255, 255, 255])), W, H);
t('blue + orange logo: blue main, orange second', r.ok && B.hexToRgb(r.primary)[2] > 180 && r.secondaryFromLogo && B.hexToRgb(r.secondary)[0] > 200, r);
// 3. white background + black text -> no colour
r = B.extractPalette(img(W, H, (x, y) => ((x + y) % 7 < 3 ? [10, 10, 10] : [255, 255, 255])), W, H);
t('black and white logo -> ok:false no-colour', !r.ok && r.reason === 'no-colour', r);
t('grey logo -> no colour', !B.extractPalette(img(W, H, () => [128, 128, 128]), W, H).ok);
t('fully transparent -> ok:false', !B.extractPalette(img(W, H, () => null), W, H).ok);
t('garbage input never throws', (() => { try { return !B.extractPalette(null, 0, 0).ok && !B.extractPalette(new Uint8Array(3), 10, 10).ok; } catch (e) { return false; } })());
// 4. hue wrap-around: colour straddling 0 degrees (red-magenta + red-orange) must still be ONE colour
r = B.extractPalette(img(W, H, (x) => (x < 50 ? [230, 20, 60] : [230, 40, 20])), W, H);
t('red straddling the hue seam is one colour, red-ish', r.ok && B.hexToRgb(r.primary)[0] > 200, r);
// 5. small logo (16x16) and large (1000x1000) both work
t('16x16 works', B.extractPalette(img(16, 16, () => [20, 160, 80]), 16, 16).ok);
t('1000x1000 works', B.extractPalette(img(1000, 1000, () => [20, 160, 80]), 1000, 1000).ok);
// contrast maths (WCAG reference values)
t('contrast black/white = 21', Math.abs(B.contrast('#000000', '#ffffff') - 21) < 0.01);
t('contrast same colour = 1', Math.abs(B.contrast('#777777', '#777777') - 1) < 0.001);
t('readableOn gold is dark text', B.readableOn('#d9a521') === '#111111');
t('readableOn navy is white text', B.readableOn('#1a2a6c') === '#ffffff');
const gold = B.ensureContrast('#d9a521', '#ffffff', 4.5); t('ensureContrast makes gold card hold white text at 4.5', B.contrast(gold, '#ffffff') >= 4.5, gold);
t('ensureContrast leaves a passing colour alone', B.ensureContrast('#15161a', '#ffffff', 4.5) === '#15161a');
const nv = B.ensureVisibleOnDark('#101840', 3); t('ensureVisibleOnDark lifts a navy stripe', B.contrast(nv, '#0c0d12') >= 3 && nv !== '#101840', nv);
t('norm rejects junk', B.norm('red', '#112233') === '#112233' && B.norm('#ABCDEF', '#000000') === '#abcdef' && !B.isHex('#abc') && !B.isHex(null));
// graphics pure helpers + API without a browser
// stub 2D context: every method is a no-op (measureText = 10 px per character) so draw() runs for real and any exception in it fails the test
const stubCtx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (t) => ({ width: String(t).length * 10 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
const el = () => ({ getContext: () => stubCtx(), width: 0, height: 0, addEventListener() {} });
const store = {}; const ctx = { window: {}, document: { readyState: 'complete', createElement: el, getElementById: () => null, addEventListener() {} }, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, performance: { now: () => 0 }, setTimeout, clearTimeout, createImageBitmap: () => Promise.resolve({ close() {} }), console };
ctx.window = ctx; vm.createContext(ctx); ctx.VS = {};
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/brand-core.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/graphics.js'), 'utf8'), ctx);
const G = ctx.VS.Graphics;
t('gameClockText 0 -> 00:00', G.pure.gameClockText(0) === '00:00');
t('gameClockText 65 s -> 01:05', G.pure.gameClockText(65000) === '01:05');
t('gameClockText keeps counting minutes past 60 (90:00)', G.pure.gameClockText(5400000) === '90:00');
t('gameClockText negative is safe', G.pure.gameClockText(-5) === '00:00');
G.setBrand('#112233', '#445566', true); t('setBrand stores both and Brand accent follows', G.state.brand.primary === '#112233' && G.state.brand.secondary === '#445566' && G.state.brand.fromLogo);
G.setBrand('banana', 'zzz'); t('setBrand ignores bad colours', G.state.brand.primary === '#112233' && G.state.brand.secondary === '#445566');
t('brand survives a save', /"primary":"#112233"/.test(store.vs_gfx || ''));
G.useBrandEverywhere(true); t('useBrandEverywhere sets lt + card to Brand', G.state.lt.accent === 'Brand' && G.state.card.accent === 'Brand');
G.useBrandEverywhere(false); t('...and false goes back to Blue', G.state.lt.accent === 'Blue' && G.state.card.accent === 'Blue');
G.setScore(true, { home: 'Lagos FC', away: 'Abuja United', h: 2, a: 1, period: '2nd half' }); const sc = G.state.score;
t('score set', sc.on && sc.home === 'Lagos FC' && sc.h === 2 && sc.a === 1 && sc.period === '2nd half');
G.scoreAdd('h', 1); G.scoreAdd('a', -5); t('score +1, never below 0', sc.h === 3 && sc.a === 0);
G.scoreAdd('h', 5000); t('score capped at 999', sc.h === 999);
G.setScore(null, { h: 'x', a: -3 }); t('bad score values become 0', sc.h === 0 && sc.a === 0);
G.setScore(null, { home: '', away: 'A very very long team name' }); t('empty name falls back, long name is cut to 14', sc.home === 'HOME' && sc.away.length === 14);
let now = 1000; ctx.performance.now = () => now; G.scoreClock('start'); now = 4000; G.scoreClock('stop'); t('clock counts 3 s then pauses', sc.base === 3000 && sc.startedAt === null);
now = 9000; G.scoreClock('start'); G.scoreClock('start'); t('double start does not restart the clock', sc.startedAt === 9000);
G.scoreClock('reset'); t('clock reset', sc.base === 0 && sc.startedAt === null);
G.applySpec({ score: { mode: 'show', home: 'A', away: 'B', h: 4, a: 2, period: 'FT' } }); t('applySpec shows score', sc.on && sc.h === 4 && sc.a === 2 && sc.period === 'FT');
G.applySpec({ score: { mode: 'hide' } }); t('applySpec hides score', !sc.on && G.isOn('score') === false);
G.setScore(true); G.clearAll(); t('Clear all hides the scoreboard', !sc.on);
G.setSafe(true); t('safe option stored + saved', G.state.safe && /"safe":true/.test(store.vs_gfx));
// Show core: score cue + Brand accent
const SC = {}; const c2 = { window: SC, console }; SC.window = SC; vm.createContext(c2); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/show-core.js'), 'utf8'), c2);
const S = SC.VS.ShowCore;
let cue = S.normaliseCue({ label: 'Goal', gfx: { score: { mode: 'show', home: 'Lagos', away: 'Abuja', h: '3', a: 1e9, period: '1st', junk: 1 }, lt: { mode: 'show', name: 'X', accent: 'Brand' }, card: { mode: 'show', title: 't', accent: 'Brand' } } });
t('cue keeps Brand accent on lt and card', cue.gfx.lt.accent === 'Brand' && cue.gfx.card.accent === 'Brand');
t('cue score is clamped (3 and 999) with no junk keys', cue.gfx.score.h === 3 && cue.gfx.score.a === 999 && !('junk' in cue.gfx.score), cue.gfx.score);
t('cue summary mentions scoreboard', /Scoreboard 3-999/.test(S.summarise(cue)), S.summarise(cue));
t('bad accent still dropped', !('accent' in S.normaliseCue({ gfx: { lt: { mode: 'show', name: 'a', accent: 'Pink' } } }).gfx.lt));
t('score hide cue ok', S.normaliseCue({ gfx: { score: { mode: 'hide' } } }).gfx.score.mode === 'hide');
t('round trip through serialise/parse', S.parse(S.serialise([cue])).cues[0].gfx.score.home === 'Lagos');
// drawing with everything on must not throw (all templates x Brand/standard accents, safe on/off)
G.setScore(true, { h: 1, a: 2, showClock: true }); G.setLive(true); G.setClock(true); G.setBug(true, 'CH', false); G.setSocial(true, '@x'); G.setQr(true, 'https://a.b', 'Scan'); G.setTicker(true); G.showBanner({ text: 'hi' }); G.showCard({ title: 'T', sub: 's', accent: 'Brand' }); G.showLT({ name: 'N', title: 'T', accent: 'Brand' });
let threw = null; try { ['classic', 'minimal', 'glass', 'bold'].forEach((tp) => ['Brand', 'Gold', 'Black'].forEach((ac) => [true, false].forEach((sf) => { G.setSafe(sf); G.setTemplate(tp); G.state.lt.accent = ac; G.draw(5000); }))); } catch (e) { threw = e.message; }
t('draw() with every graphic on, 4 templates x 3 accents x safe on/off, never throws', threw === null, threw);
process.exit(bad ? 1 : 0);
