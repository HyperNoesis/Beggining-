/**
 * Picks the real recording-storage backend based on js/config.js — same
 * pattern as js/auth.js: local IndexedDB by default, or Supabase-backed
 * cloud sync once supabaseUrl/supabaseAnonKey are filled in. Every page
 * calls window.VS.storage.* the same way regardless of which is active,
 * so nothing else in the app needs to know or care.
 *
 * Drafts (crash-safe in-progress-recording autosave) always use IndexedDB
 * directly, cloud or not — see the note in providers/storage-provider.js.
 */
(function () {
  const DB_NAME = 'virtual-studio';
  const STORE = 'recordings';
  const DRAFT_STORE = 'drafts';
  const CHUNK_STORE = 'draft_chunks';
  const DB_VERSION = 3; // v1: recordings only. v2: + drafts. v3: + draft_chunks (append-only chunk autosave, no full rewrite).
  const DRAFT_ID = 'draft_current';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          db.createObjectStore(CHUNK_STORE, { keyPath: 'k' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ============================================================
  // Crash-safe draft autosave — while a recording is in progress, the
  // Studio periodically writes what's captured so far here. If the tab
  // crashes or closes before Stop is pressed, the partial clip survives
  // and can be recovered on next load instead of being silently lost.
  // Always local — never synced, see providers/storage-provider.js.
  // ============================================================
  async function saveDraft(blob, meta) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).put({ id: DRAFT_ID, blob, meta, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // v0.13 append-only drafts: each recorder chunk is stored on its own as it arrives (small write, no growing re-copy),
  // and the draft is rebuilt from the chunks on recovery. Old single-blob drafts (v2) are still recoverable.
  function idbDone(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }
  async function startDraft(meta, mime) {
    await clearDraft();
    const session = 's' + Date.now();
    const db = await openDB();
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    tx.objectStore(DRAFT_STORE).put({ id: DRAFT_ID, session, meta, mime: mime || 'video/webm', updatedAt: Date.now() });
    await idbDone(tx);
    return session;
  }
  async function appendDraftChunk(session, index, blob) {
    const db = await openDB();
    const tx = db.transaction(CHUNK_STORE, 'readwrite');
    tx.objectStore(CHUNK_STORE).put({ k: session + ':' + String(index).padStart(7, '0'), blob, t: Date.now() });
    return idbDone(tx);
  }
  async function getDraft() {
    const db = await openDB();
    const meta = await new Promise((resolve, reject) => {
      const req = db.transaction(DRAFT_STORE, 'readonly').objectStore(DRAFT_STORE).get(DRAFT_ID);
      req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
    });
    if (!meta) return null;
    if (!meta.session) return meta;                                   // legacy v2 draft: already has .blob
    const chunks = await new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(meta.session + ':', meta.session + ':\uffff');
      const req = db.transaction(CHUNK_STORE, 'readonly').objectStore(CHUNK_STORE).getAll(range);
      req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
    });
    if (!chunks.length) return null;                                  // recording never got its first chunk: nothing to recover
    chunks.sort((a, b) => (a.k < b.k ? -1 : 1));
    return { id: meta.id, meta: meta.meta || {}, blob: new Blob(chunks.map((c) => c.blob), { type: meta.mime || 'video/webm' }), updatedAt: chunks[chunks.length - 1].t };
  }
  async function clearDraft() {
    const db = await openDB();
    const tx = db.transaction([DRAFT_STORE, CHUNK_STORE], 'readwrite');
    tx.objectStore(DRAFT_STORE).delete(DRAFT_ID);
    tx.objectStore(CHUNK_STORE).clear();
    return idbDone(tx);
  }

  // Which recording format this browser can really make (VP9 webm is NOT available everywhere, e.g. iPhone Safari).
  function pickRecorderMime(MR) {
    MR = MR || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
    if (!MR || !MR.isTypeSupported) return '';
    const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
    return list.find((t) => { try { return MR.isTypeSupported(t); } catch (e) { return false; } }) || '';
  }
  const extForMime = (m) => (/mp4/.test(m || '') ? 'mp4' : 'webm');
  window.VS = window.VS || {};
  window.VS.pickRecorderMime = pickRecorderMime; window.VS.extForMime = extForMime;

  const cfg = window.VS && window.VS.config;
  const useSupabase = cfg && cfg.supabaseUrl && cfg.supabaseAnonKey;
  const provider = useSupabase
    ? new window.VS.SupabaseStorageProvider(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : new window.VS.LocalStorageProvider(openDB);

  window.VS = window.VS || {};
  window.VS.storage = {
    saveRecording: (...a) => provider.saveRecording(...a),
    listRecordings: (...a) => provider.listRecordings(...a),
    deleteRecording: (...a) => provider.deleteRecording(...a),
    getRecording: (...a) => provider.getRecording(...a),
    updateRecordingMeta: (...a) => provider.updateRecordingMeta(...a),
    duplicateRecording: (...a) => provider.duplicateRecording(...a),
    saveDraft, startDraft, appendDraftChunk, getDraft, clearDraft,
    mode: useSupabase ? 'supabase' : 'local',
  };
})();
