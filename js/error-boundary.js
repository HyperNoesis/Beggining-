/**
 * Error boundary — a vanilla-JS app has no React-style component boundary,
 * so this is the honest equivalent: catch what would otherwise be a silent
 * white-screen failure (uncaught throw, unhandled promise rejection) and
 * surface it as a small dismissible toast instead of nothing happening.
 * It does not "recover" the failed operation — it makes failure visible
 * and gives the person a reload path, which is what most of these crashes
 * actually need.
 */
(function () {
  function ensureToastHost() {
    let host = document.getElementById('vsErrorToastHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'vsErrorToastHost';
    host.style.cssText = 'position:fixed; bottom:18px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:8px; max-width:min(92vw,420px);';
    document.body.appendChild(host);
    return host;
  }

  function showToast(message) {
    try {
      const host = ensureToastHost();
      // Don't pile up duplicate toasts for repeated errors from the same loop.
      if (host.children.length >= 3) return;
      const toast = document.createElement('div');
      toast.setAttribute('role', 'alert');
      toast.style.cssText = 'background:#1c1029; border:1px solid #ef445544; color:#f2eaff; padding:12px 14px; border-radius:10px; font-size:12.5px; line-height:1.5; box-shadow:0 8px 24px rgba(0,0,0,0.4); display:flex; gap:10px; align-items:flex-start;';
      toast.innerHTML = `
        <span style="flex:1;">Something went wrong: ${message}. You can keep going, or reload if things look stuck.</span>
        <button type="button" aria-label="Dismiss" style="background:none;border:none;color:#c9b8e6;cursor:pointer;font-size:15px;line-height:1;padding:0;">&times;</button>
      `;
      toast.querySelector('button').addEventListener('click', () => toast.remove());
      host.appendChild(toast);
      setTimeout(() => toast.remove(), 12000);
    } catch (e) { /* the error boundary itself must never throw */ }
  }

  window.addEventListener('error', (e) => {
    // Ignore benign cross-origin script errors ("Script error.") that carry no useful info.
    if (!e || !e.message || e.message === 'Script error.') return;
    showToast(e.message.length > 140 ? e.message.slice(0, 140) + '…' : e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason ? (e.reason.message || String(e.reason)) : 'an operation failed';
    showToast(reason.length > 140 ? reason.slice(0, 140) + '…' : reason);
  });

  window.VS = window.VS || {};
  window.VS.reportError = showToast; // app code can also surface handled-but-notable errors the same way
})();
