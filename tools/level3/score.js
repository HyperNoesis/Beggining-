#!/usr/bin/env node
// Turns hand scores (1-5) into a ranked report. Usage: node score.js scores.json > report.md
// scores.json: { "candidate-name": { "identity":4, "body":3, ... "costPerClipUsd": 0.5, "notes":"..." }, ... }
// Rule: a candidate with ANY hard-gate criterion <=2 is "FAIL" no matter how high the average is. Watch the WHOLE video, not a still.
const CRIT = [['identity', 'Identity / facial consistency'], ['body', 'Body and limb stability'], ['movement', 'Preservation of movement'], ['chairRemoved', 'Original chair removed/concealed'], ['contact', 'Natural contact with the virtual couch'], ['occlusion', 'Correct occlusion'], ['perspective', 'Perspective and scale'], ['lighting', 'Lighting'], ['stability', 'Temporal stability / flicker'], ['resolution', 'Usable resolution and duration'], ['latency', 'Latency (5 = under 1 min, 1 = over 15 min)']];
const GATES = ['identity', 'body', 'chairRemoved', 'stability'];
const s = JSON.parse(require('fs').readFileSync(process.argv[2] || 'scores.json', 'utf8'));
const rows = Object.entries(s).map(([n, v]) => {
  const miss = CRIT.filter(([k]) => typeof v[k] !== 'number'); const vals = CRIT.map(([k]) => v[k]).filter((x) => typeof x === 'number');
  const avg = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0; const gateFail = GATES.filter((k) => v[k] <= 2);
  return { n, avg, miss: miss.map((m) => m[0]), gateFail, cost: v.costPerClipUsd, notes: v.notes || '' };
}).sort((a, b) => b.avg - a.avg);
console.log('# Level 3 experiment report\n');
console.log('| Candidate | Avg (1-5) | Verdict | Missing scores | Cost per usable clip | Notes |\n|---|---|---|---|---|---|');
for (const r of rows) console.log('| ' + r.n + ' | ' + r.avg.toFixed(2) + ' | ' + (r.miss.length ? 'INCOMPLETE' : r.gateFail.length ? 'FAIL (' + r.gateFail.join(', ') + ' <= 2)' : r.avg >= 3.5 ? 'USABLE as optional post-process' : 'WEAK') + ' | ' + (r.miss.join(', ') || '-') + ' | ' + (r.cost == null ? 'unknown' : '$' + r.cost) + ' | ' + r.notes.replace(/\|/g, '/') + ' |');
console.log('\nCriteria: ' + CRIT.map((c) => c[1]).join('; ') + '.\nGate criteria (any <=2 = FAIL): ' + GATES.join(', ') + '.');
