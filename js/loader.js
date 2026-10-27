/**
 * Tiny on-demand script loader. Heavy third-party libraries (MediaPipe, onnxruntime) are loaded only when a
 * code path actually needs them, instead of blocking the whole page at startup.
 *   VS.loadScript(url, {fallbacks:[...]}) -> Promise (each URL is fetched at most once)
 */
(function () {
  window.VS = window.VS || {};
  const cache = new Map();
  function inject(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve(url);
      s.onerror = () => { s.remove(); reject(new Error('Could not load ' + url)); };
      document.head.appendChild(s);
    });
  }
  window.VS.loadScript = function (url, opts) {
    const urls = [url].concat((opts && opts.fallbacks) || []);
    const key = urls.join('|');
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      let lastErr = null;
      for (const u of urls) {
        try { return await inject(u); } catch (e) { lastErr = e; }
      }
      cache.delete(key);   // allow a later retry
      throw lastErr || new Error('Could not load ' + url);
    })();
    cache.set(key, p);
    return p;
  };
})();
