/**
 * "AI re-render (experimental)" button under a saved recording. OPT-IN: hidden unless js/config.js has renderRelayUrl.
 * Never runs by itself, never touches the live loop, never edits the original recording: the result is a NEW item.
 */
(function () {
  'use strict';
  const VS = (window.VS = window.VS || {});
  const cfg = () => (VS.config || {});
  function relayUrl() { const c = cfg(); return (c.renderRelayUrl || '').trim(); }
  function attach(item, blob, onResult) {
    const RP = VS.RenderProvider; if (!RP || !relayUrl() || !item || !blob) return;
    const wrap = document.createElement('div'); wrap.className = 'honesty-note'; wrap.style.cssText = 'margin-top:8px;';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn ghost'; btn.style.minHeight = '44px'; btn.textContent = 'AI re-render as lounge sofa (experimental)';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn ghost'; cancel.style.cssText = 'min-height:44px;display:none;margin-left:6px;'; cancel.textContent = 'Cancel';
    const msg = document.createElement('p'); msg.setAttribute('role', 'status'); msg.style.margin = '6px 0 0';
    wrap.append(btn, cancel, msg); item.appendChild(wrap);
    const LABEL = { uploading: 'Uploading the clip...', queued: 'Waiting in the queue...', running: 'The AI is rendering (often several minutes)...', downloading: 'Downloading the result...' };
    let job = null;
    btn.addEventListener('click', async () => {
      if (job) return;
      if (!window.confirm(RP.PRIVACY_NOTICE + '\n\nContinue?')) return;
      btn.disabled = true; cancel.style.display = ''; msg.textContent = 'Starting...';
      const adapter = RP.createRelayAdapter({ baseUrl: relayUrl(), token: cfg().renderRelayToken || '' });
      job = RP.runRenderJob({ adapter, clip: blob, prompt: RP.LEVEL3_PROMPT, options: { resolution: '720p', duration: 6 }, onState: (s, x) => { msg.textContent = (x && x.message) || LABEL[s] || (s === 'done' ? 'Done.' : s === 'cancelled' ? 'Cancelled.' : ''); } });
      const r = await job.promise; job = null; cancel.style.display = 'none'; btn.disabled = false;
      if (r.ok && r.result && r.result.blob) { msg.textContent = 'Done. The AI version was saved as a NEW recording; your original is untouched. Check it carefully: it is experimental.'; try { onResult && onResult(r.result.blob); } catch (e) { /* ignore */ } }
      else if (r.ok) {
        msg.textContent = 'Finished, but this browser could not download it directly. Original untouched. ';
        if (r.result && /^https?:\/\//.test(r.result.url || '')) { const a = document.createElement('a'); a.href = r.result.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open the AI version'; msg.appendChild(a); }
      }
      else if (r.state !== 'cancelled') msg.textContent = r.error;
    });
    cancel.addEventListener('click', () => { if (job) job.cancel(); });
  }
  VS.RenderUI = { attach, relayUrl };
})();
