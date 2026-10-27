/**
 * EnvironmentProvider — interface contract.
 *
 *   list(): Array<{ id, name, type }>
 *   render(ctx, id, width, height): void   // draws the environment into a canvas context
 *   addCustomImage(id, name, imageElement): void
 */

const BUILT_IN_ENVIRONMENTS = [
  { id: 'podcast-studio', name: 'Podcast Studio', category: 'Podcast', colors: ['#2b1b3d', '#0d0715'], image: 'assets/environments/podcast-studio.jpg' },
  { id: 'corporate-office', name: 'Corporate Office', category: 'Work', colors: ['#dfe6ee', '#aab8c2'], image: 'assets/environments/corporate-office.jpg' },
  { id: 'newsroom', name: 'Newsroom', category: 'Broadcast', colors: ['#1b2735', '#090a0f'], image: 'assets/environments/newsroom.jpg' },
  { id: 'classroom', name: 'Classroom', category: 'Work', colors: ['#fdfbfb', '#ebedee'], image: 'assets/environments/classroom.jpg' },
  { id: 'outdoor', name: 'Outdoor', category: 'Lifestyle', colors: ['#87ceeb', '#e0f7fa'], image: 'assets/environments/outdoor.jpg' },
  { id: 'interview-studio', name: 'Interview Studio', category: 'Broadcast', colors: ['#3a1c1c', '#150a0a'], image: 'assets/environments/interview-studio.jpg' },
  { id: 'moody-blue-backdrop', name: 'Moody Blue Backdrop', category: 'Studio', colors: ['#173142', '#050a0f'], image: 'assets/environments/moody-blue-backdrop.jpg' },
  { id: 'concrete-studio', name: 'Concrete Studio', category: 'Studio', colors: ['#5a626b', '#22262b'], image: 'assets/environments/concrete-studio.jpg' },
  { id: 'broadcast-wall', name: 'Broadcast Wall', category: 'Broadcast', colors: ['#0d2f66', '#060912'], image: 'assets/environments/broadcast-wall.jpg' },
  { id: 'brick-podcast-room', name: 'Brick Podcast Room', category: 'Podcast', colors: ['#5a3a2c', '#1c120d'], image: 'assets/environments/brick-podcast-room.jpg' },
  { id: 'color-backdrop-studio', name: 'Color Backdrop Studio', category: 'Studio', colors: ['#1c3f66', '#e7e7ea'], image: 'assets/environments/color-backdrop-studio.jpg' },
  { id: 'gear-room', name: 'Gear Room', category: 'Studio', colors: ['#2a2a2e', '#0c0c0e'], image: 'assets/environments/gear-room.jpg' },
];

// M4: purpose-built desk scenes (scene.json library). Validated on load; a bad scene is skipped, never fatal.
(function () {
  try {
    const V = window.VS || {};
    if (!V.SceneMeta || !V.SCENE_LIBRARY) return;
    V.SceneMeta.loadLibrary(V.SCENE_LIBRARY).scenes.forEach((m) => {
      BUILT_IN_ENVIRONMENTS.push({ id: m.id, name: m.name, category: 'Studio Scenes', colors: ['#20242c', '#0b0d11'], image: m.image, scene: true, sceneType: m.type });
    });
  } catch (e) { /* keep the classic environments */ }
})();

const CUSTOM_ENV_KEY = 'vs_custom_environments';

class StaticEnvironmentProvider {
  constructor() {
    this.customImages = new Map(); // id -> HTMLImageElement
    this.customNames = new Map();  // id -> display name
    this.builtinImageCache = new Map(); // id -> HTMLImageElement (real photos for built-ins that have one)
  }

  /** Preloads real photos for any built-in environment that has one, so render() can draw them synchronously. */
  async loadBuiltinImages() {
    const withImages = BUILT_IN_ENVIRONMENTS.filter(e => e.image && !this.builtinImageCache.has(e.id));
    await Promise.all(withImages.map(env => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.builtinImageCache.set(env.id, img); resolve(); };
      img.onerror = () => resolve(); // falls back to gradient if the photo fails to load
      img.src = env.image;
    })));
  }

  list() {
    const builtIns = BUILT_IN_ENVIRONMENTS.map(e => ({ id: e.id, name: e.name, type: e.image ? 'photo' : 'gradient', category: e.category || 'Custom' }));
    const custom = Array.from(this.customImages.keys()).map(id => ({ id, name: this.customNames.get(id) || id, type: 'image', category: 'Custom' }));
    return [...builtIns, ...custom];
  }

  addCustomImage(id, imageElement, name) {
    this.customImages.set(id, imageElement);
    this.customNames.set(id, name || id);
  }

  removeCustomImage(id) {
    this.customImages.delete(id);
    this.customNames.delete(id);
    const stored = JSON.parse(localStorage.getItem(CUSTOM_ENV_KEY) || '[]').filter(e => e.id !== id);
    localStorage.setItem(CUSTOM_ENV_KEY, JSON.stringify(stored));
  }

  renameCustomImage(id, newName) {
    if (!this.customImages.has(id)) return;
    this.customNames.set(id, newName);
    const stored = JSON.parse(localStorage.getItem(CUSTOM_ENV_KEY) || '[]');
    const entry = stored.find(e => e.id === id);
    if (entry) { entry.name = newName; localStorage.setItem(CUSTOM_ENV_KEY, JSON.stringify(stored)); }
  }

  /**
   * Persists a custom background to localStorage (downscaled to keep the
   * browser's storage quota sane) so it survives reloads and shows up on
   * every page, not just the one it was uploaded from.
   */
  static async persistCustomImage(name, imageElement) {
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / imageElement.naturalWidth);
    const w = Math.round(imageElement.naturalWidth * scale);
    const h = Math.round(imageElement.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(imageElement, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);

    const id = 'custom-' + Date.now();
    const stored = JSON.parse(localStorage.getItem(CUSTOM_ENV_KEY) || '[]');
    stored.push({ id, name, dataUrl });
    try {
      localStorage.setItem(CUSTOM_ENV_KEY, JSON.stringify(stored));
    } catch (e) {
      throw new Error('Could not save — local storage is full. Try deleting an old custom environment first.');
    }
    return id;
  }

  /** Returns a CSS background value for card thumbnails — the real gradient/image, not a placeholder icon alone. */
  getPreviewStyle(id) {
    if (this.customImages.has(id)) {
      return `background-image:url(${this.customImages.get(id).src}); background-size:cover; background-position:center;`;
    }
    const env = BUILT_IN_ENVIRONMENTS.find(e => e.id === id);
    if (!env) return '';
    if (env.image) {
      return `background-image:url(${env.image}); background-size:cover; background-position:center;`;
    }
    return `background: linear-gradient(160deg, ${env.colors[0]}, ${env.colors[1]});`;
  }

  /** Loads previously persisted custom environments into this provider instance. */
  async hydrateFromStorage() {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_ENV_KEY) || '[]');
    await Promise.all([
      this.loadBuiltinImages(),
      ...stored.map(entry => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { this.addCustomImage(entry.id, img, entry.name); resolve(); };
        img.onerror = () => resolve();
        img.src = entry.dataUrl;
      }))
    ]);
  }

  render(ctx, id, width, height) {
    if (this.customImages.has(id)) {
      ctx.drawImage(this.customImages.get(id), 0, 0, width, height);
      return;
    }
    if (this.builtinImageCache.has(id)) {
      ctx.drawImage(this.builtinImageCache.get(id), 0, 0, width, height);
      return;
    }
    const env = BUILT_IN_ENVIRONMENTS.find(e => e.id === id) || BUILT_IN_ENVIRONMENTS[0];
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, env.colors[0]);
    grad.addColorStop(1, env.colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * AIEnvironmentProvider — EXTENSION POINT, NOT IMPLEMENTED.
 * Wire this to an image-generation API when you're ready to pay for
 * text-to-environment generation. Until then, the "Generate" button in the
 * UI is visibly disabled with an honest label — it never pretends to work.
 */
class AIEnvironmentProvider {
  async generate(promptText) {
    throw new Error(
      'AIEnvironmentProvider.generate() is not implemented — no image-generation API is ' +
      'connected yet. This is intentional: the button stays disabled rather than faking a result.'
    );
  }
}

window.VS = window.VS || {};
window.VS.StaticEnvironmentProvider = StaticEnvironmentProvider;
window.VS.AIEnvironmentProvider = AIEnvironmentProvider;
