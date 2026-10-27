// Node unit test for PerfProfile.decideSaver (pure logic). Run: node tools/e2e/unit_saver.js
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { self: {} }; ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/providers/perf-profile.js'), 'utf8'), ctx);
const d = ctx.VS.PerfProfile.decideSaver; let bad = 0;
const t = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + ' -> ' + got); };
t('saver already on', d({ saverOn: true, level: 0.05, charging: false, pressure: 'critical' }), 'none');
t('critical pressure throttles', d({ saverOn: false, pressure: 'critical' }), 'auto-throttle');
t('serious pressure throttles', d({ saverOn: false, pressure: 'serious' }), 'auto-throttle');
t('nominal + healthy battery', d({ saverOn: false, level: 0.8, charging: false, pressure: 'nominal' }), 'none');
t('low battery discharging suggests', d({ saverOn: false, level: 0.15, charging: false }), 'suggest-saver');
t('low battery but charging', d({ saverOn: false, level: 0.15, charging: true }), 'none');
t('no signals at all', d({ saverOn: false }), 'none');
t('exactly 20 percent suggests', d({ saverOn: false, level: 0.2, charging: false }), 'suggest-saver');
process.exit(bad ? 1 : 0);
