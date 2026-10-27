/**
 * Blind test logic (brief: "at least 7 of 10 viewers do not notice the background is virtual").
 * Pure functions (no DOM) so they are unit-tested. The page is blindtest.html.
 *
 * Definition used (documented in docs/BLIND_TEST.md, change it there and here together):
 *  - A session shows each viewer a shuffled set of items, each either REAL (a real room) or VIRTUAL (a Genesis scene).
 *  - The viewer answers "looks real" or "looks virtual" for every item.
 *  - A viewer DID NOT NOTICE if they called at most 40% of the VIRTUAL items "virtual".
 *  - The viewer's false-alarm rate (REAL items called "virtual") is shown next to it, so a viewer who says "virtual" to everything is visible.
 *  - PASS = at least 70% of viewers (and at least 10 viewers) did not notice.
 * Honest limit: it needs real people and real footage of real rooms. The numbers it prints are only as good as that set.
 */
(function () {
  const NOTICE_MAX = 0.4, PASS_SHARE = 0.7, MIN_VIEWERS = 10;
  function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** Fisher-Yates with a seed, so a session can be reproduced. Returns a new array. */
  function shuffle(list, seed) { const r = mulberry(seed || 1), a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /** answers: [{ itemId, truth:'real'|'virtual', said:'real'|'virtual' }] -> stats for one viewer. */
  function viewerStats(answers) {
    const v = answers.filter((a) => a.truth === 'virtual'), r = answers.filter((a) => a.truth === 'real');
    const noticed = v.filter((a) => a.said === 'virtual').length, fa = r.filter((a) => a.said === 'virtual').length;
    const noticeRate = v.length ? noticed / v.length : null, falseAlarm = r.length ? fa / r.length : null;
    return { virtualItems: v.length, realItems: r.length, noticeRate, falseAlarm, didNotNotice: noticeRate !== null && noticeRate <= NOTICE_MAX };
  }
  /** viewers: [{ name, answers }] -> verdict. */
  function summarize(viewers) {
    const per = viewers.map((x) => Object.assign({ name: x.name }, viewerStats(x.answers || [])));
    const valid = per.filter((p) => p.noticeRate !== null);
    const fooled = valid.filter((p) => p.didNotNotice).length;
    const share = valid.length ? fooled / valid.length : 0;
    const enough = valid.length >= MIN_VIEWERS;
    return { viewers: valid.length, didNotNotice: fooled, share, enough, pass: enough && share >= PASS_SHARE,
      message: !valid.length ? 'No finished sessions yet.' : !enough ? 'Only ' + valid.length + ' viewer(s): ' + fooled + ' did not notice. This is not a result until you have at least ' + MIN_VIEWERS + '.' :
        fooled + ' of ' + valid.length + ' viewers did not notice (' + Math.round(share * 100) + '%). Target: ' + Math.round(PASS_SHARE * 100) + '%. ' + (share >= PASS_SHARE ? 'PASS.' : 'NOT YET.'), per };
  }
  function toCSV(viewers) { const rows = ['viewer,item,truth,said']; viewers.forEach((v) => (v.answers || []).forEach((a) => rows.push([v.name, a.itemId, a.truth, a.said].map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')))); return rows.join('\n'); }
  globalThis.VS = globalThis.VS || {};
  globalThis.VS.BlindTest = { NOTICE_MAX, PASS_SHARE, MIN_VIEWERS, shuffle, viewerStats, summarize, toCSV };
})();
