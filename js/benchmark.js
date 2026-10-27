/**
 * Realism benchmark — a structured checklist for the test docs/ROADMAP.md
 * says has to happen before Milestone 4 (quality/refinement) means
 * anything. This page has no camera access and does no judging itself —
 * it can't, matting quality is a human-eyes call. What it does is turn
 * "go test it" into an actual, fillable, savable grid instead of a
 * one-line TODO, so the decision is based on real results, not a guess.
 *
 * Storage: one localStorage key, JSON, this device only — matches every
 * other local-only feature in this app (templates, drafts, Groq key).
 */
(function () {
  const STORAGE_KEY = 'vs_realism_benchmark';
  const MODES = ['fast', 'balanced', 'quality'];
  const RATINGS = ['', 'pass', 'marginal', 'fail'];
  const RATING_LABELS = { '': 'Not tested', pass: 'Pass', marginal: 'Marginal', fail: 'Fail' };

  const SCENARIOS = [
    { id: 'static', label: 'Sitting still', how: 'Sit normally, talk with hands still, 3–5s.' },
    { id: 'walking', label: 'Walking in frame', how: 'Walk side to side across the full frame.' },
    { id: 'hands', label: 'Fast hand movement', how: 'Gesture quickly, wave, point, close to the camera.' },
    { id: 'headturn', label: 'Head rotation', how: 'Turn your head profile-to-profile, tilt up/down.' },
    { id: 'lowlight', label: 'Low light', how: 'Dim the room lights, or move away from your window.' },
    { id: 'brightlight', label: 'Bright / backlit', how: 'Strong light behind you, or a bright window at your back.' },
    { id: 'glasses', label: 'Glasses', how: 'If you wear glasses; if not, skip and note it.' },
    { id: 'hair', label: 'Long / loose hair', how: 'Hair loose and moving, or a hood/hat with loose edges.' },
    { id: 'pattern', label: 'Patterned clothing', how: 'A busy pattern or a color close to your background.' },
  ];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { results: {}, notes: '' };
    } catch (e) { return { results: {}, notes: '' }; }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function renderTable(state) {
    const tbody = document.querySelector('#benchTable tbody');
    tbody.innerHTML = SCENARIOS.map((s) => `
      <tr>
        <td class="scenario">${s.label}<span class="scenario-how">${s.how}</span></td>
        ${MODES.map((m) => {
          const val = (state.results[s.id] && state.results[s.id][m]) || '';
          return `<td><select data-scenario="${s.id}" data-mode="${m}" class="${val ? 'rating-' + val : ''}">
            ${RATINGS.map((r) => `<option value="${r}" ${r === val ? 'selected' : ''}>${RATING_LABELS[r]}</option>`).join('')}
          </select></td>`;
        }).join('')}
      </tr>
    `).join('');

    tbody.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const { scenario, mode } = sel.dataset;
        state.results[scenario] = state.results[scenario] || {};
        state.results[scenario][mode] = sel.value;
        sel.className = sel.value ? 'rating-' + sel.value : '';
        renderSummary(state);
      });
    });
  }

  function renderSummary(state) {
    const counts = { pass: 0, marginal: 0, fail: 0, total: SCENARIOS.length * MODES.length, tested: 0 };
    SCENARIOS.forEach((s) => MODES.forEach((m) => {
      const v = state.results[s.id] && state.results[s.id][m];
      if (v) { counts.tested++; counts[v] = (counts[v] || 0) + 1; }
    }));
    const el = document.getElementById('benchSummary');
    if (!counts.tested) {
      el.textContent = 'No results yet — fill in the grid above after testing in Studio.';
      return;
    }
    el.innerHTML = `<strong>${counts.tested}/${counts.total}</strong> cells tested — `
      + `<span style="color:var(--success);">${counts.pass || 0} pass</span>, `
      + `<span style="color:#f5a623;">${counts.marginal || 0} marginal</span>, `
      + `<span style="color:var(--danger);">${counts.fail || 0} fail</span>.`
      + (counts.fail >= 3 ? ' Enough failures here to justify Milestone 4 (a real paid matting provider) — see docs/MODEL_PROVIDER.md.' : '')
      + (counts.tested >= counts.total && !counts.fail ? ' Clean sweep — the free local model may be enough; no spend justified yet.' : '');
  }

  function exportMarkdown(state) {
    const lines = ['# Genesis realism benchmark', '', `_Exported ${new Date().toLocaleString()}_`, '', '| Scenario | FAST | BALANCED | QUALITY |', '|---|---|---|---|'];
    SCENARIOS.forEach((s) => {
      const r = state.results[s.id] || {};
      lines.push(`| ${s.label} | ${RATING_LABELS[r.fast || '']} | ${RATING_LABELS[r.balanced || '']} | ${RATING_LABELS[r.quality || '']} |`);
    });
    if (state.notes) lines.push('', '## Notes', '', state.notes);
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `genesis-realism-benchmark-${Date.now()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  (async () => {
    const user = await window.VS.renderNav('benchmark');
    if (!user) return;

    const state = loadState();
    renderTable(state);
    renderSummary(state);
    document.getElementById('benchNotes').value = state.notes || '';

    document.getElementById('saveBenchBtn').addEventListener('click', () => {
      state.notes = document.getElementById('benchNotes').value;
      saveState(state);
      const msg = document.getElementById('benchSaveMsg');
      msg.textContent = 'Saved.';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    });

    document.getElementById('exportBenchBtn').addEventListener('click', () => {
      state.notes = document.getElementById('benchNotes').value;
      saveState(state);
      exportMarkdown(state);
    });
  })();
})();
