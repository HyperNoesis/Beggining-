// Genesis service worker: makes the app installable and lets the shell
// (pages, CSS, JS, built-in environment images) load with no network.
// Live features (AI transcription, environment generation, cloud sync)
// genuinely need network and fail through their own providers offline —
// this worker doesn't and can't fake those.

// Bump on every deploy that touches js/*, css/*, or SHELL_ASSETS — this is
// what forces an already-installed client to drop stale cached files.
const SHELL_CACHE = 'genesis-shell-v076';
const RUNTIME_CACHE = 'genesis-runtime-v10';

const SHELL_ASSETS = [
  'index.html', 'home.html', 'studio.html', 'editor.html', 'audio.html',
  'environments.html', 'projects.html', 'settings.html', 'auth.html',
  'call.html', 'remote.html', 'cam.html', 'landing.html', 'privacy.html', 'terms.html', 'docs/PRIVACY.md', 'docs/TERMS.md',
  'manifest.json',
  'css/style.css',
  'js/light-meter.js', 'js/app.js', 'js/diagnostics.js', 'js/teleprompter.js', 'js/grade-core.js', 'js/grade-ui.js', 'js/prompter-core.js', 'js/prompter-remote.js', 'js/multisource-core.js', 'js/worklets/rnnoise-worklet.js', 'js/trim.js', 'js/providers/render-provider.js', 'js/render-ui.js', 'js/ba-capture.js', 'js/legal.js', 'js/landing.js', 'js/golive-core.js', 'js/golive.js', 'js/multisource.js', 'js/cam.js', 'js/remote.js', 'js/graphics.js', 'js/qr.js', 'js/brand-core.js', 'js/show-core.js', 'js/show.js', 'js/looks.js', 'js/audio-chain.js', 'js/audio-ui.js', 'js/audio-mix.js', 'js/rec-extras.js', 'js/providers/lufs-meter.js', 'js/worklets/lufs-worklet.js', 'js/audio-studio.js', 'js/auth.js', 'js/config.js',
  'js/editor.js', 'js/error-boundary.js', 'js/icons.js', 'js/iris.js',
  'js/nav.js', 'js/storage.js', 'js/templates.js', 'js/call.js',
  'js/camera-bridge-client.js',
  'js/render-core.js', 'js/render-worker.js',
  'js/providers/auth-provider.js', 'js/providers/captions-provider.js',
  'js/providers/composition-engine.js', 'js/providers/environment-provider.js',
  'js/providers/groq-transcription.js', 'js/providers/lufs-meter.js',
  'js/providers/mask-refine.js', 'js/loader.js', 'js/ort-loader.js', 'js/studio-check.js', 'js/providers/modnet-worker.js', 'js/supabase-loader.js', 'js/providers/gl-matte.js', 'js/providers/scene-engine.js', 'js/providers/pose-gate.js', 'js/providers/modnet-provider.js', 'js/providers/realism-engine.js',
  'js/providers/perf-profile.js', 'js/providers/scene-meta.js', 'js/providers/scene-library.js', 'js/scene-wizard.js', 'js/effects-speed.js', 'desklabel.html', 'js/desklabel.js', 'js/blindtest.js', 'blindtest.html',
  'js/providers/segmentation-provider.js',
  'assets/logo.png', 'assets/logo-mark.png',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/environments/brick-podcast-room.jpg', 'assets/environments/broadcast-wall.jpg',
  'assets/environments/classroom.jpg', 'assets/environments/color-backdrop-studio.jpg',
  'assets/environments/concrete-studio.jpg', 'assets/environments/corporate-office.jpg',
  'assets/environments/gear-room.jpg', 'assets/environments/interview-studio.jpg',
  'assets/environments/moody-blue-backdrop.jpg', 'assets/environments/newsroom.jpg',
  'assets/environments/outdoor.jpg', 'assets/environments/podcast-studio.jpg',
].concat(['news-desk','podcast-wood','talk-show','classroom-desk','office-bright','library-warm','living-room','terrace','minimal-studio','stage-hall','sports-desk','tech-review'].map((n) => 'assets/environments/scene-' + n + '.jpg')).concat(['assets/environments/scene-living-room-fg.png']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('Genesis SW: shell precache incomplete', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin && /\/vendor\//.test(url.pathname)) {
    // Self-hosted engine files (MediaPipe wasm + model, ~11 MB): CACHE-FIRST. They are versioned by path and never
    // change in place, so after the first visit Studio starts without downloading anything.
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Network-first, cache as fallback — an actively-developed multi-page
    // app needs correctness over instant offline-boot speed.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cross-origin: only cache known static-library CDNs (jsdelivr/unpkg),
  // so the shell can boot offline after a first load. Live API hosts
  // (Groq, Pollinations, Supabase) are left untouched — a cached
  // "successful" response there would mean serving stale data offline.
  if (!/jsdelivr\.net|unpkg\.com|huggingface\.co|(^|\.)hf\.co$|storage\.googleapis\.com/.test(url.hostname)) return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }))
  );
});
