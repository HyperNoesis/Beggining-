/**
 * StorageProvider — interface contract, both implementations return
 * Promises so the app works identically whether recordings live on this
 * device only or synced to the cloud:
 *
 *   async saveRecording(blob, meta) -> id
 *   async listRecordings() -> [{ id, meta, createdAt, blob? }]  (blob omitted
 *     from list results for the cloud provider — fetched lazily by
 *     getRecording() so the list itself stays fast even with many/large
 *     recordings)
 *   async getRecording(id) -> { id, blob, meta, createdAt } | null
 *   async updateRecordingMeta(id, patch) -> updated record | null
 *   async duplicateRecording(id) -> new id
 *   async deleteRecording(id) -> void
 *
 * Drafts (crash-safe in-progress-recording autosave) are NOT part of this
 * interface — they're an inherently per-device safety net (recovering from
 * a crashed tab before a recording even finished), not something worth
 * syncing, so js/storage.js always routes those straight to IndexedDB
 * regardless of which provider is active here.
 */

class LocalStorageProvider {
  constructor(db) {
    this._db = db; // shared IndexedDB handle opener from js/storage.js
  }

  async saveRecording(blob, meta) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      const record = { id: `rec_${Date.now()}`, blob, meta, createdAt: Date.now() };
      tx.objectStore('recordings').put(record);
      tx.oncomplete = () => resolve(record.id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getRecording(id) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly');
      const req = tx.objectStore('recordings').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async updateRecordingMeta(id, patch) {
    const existing = await this.getRecording(id);
    if (!existing) return null;
    existing.meta = { ...existing.meta, ...patch };
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').put(existing);
      tx.oncomplete = () => resolve(existing);
      tx.onerror = () => reject(tx.error);
    });
  }

  async duplicateRecording(id) {
    const existing = await this.getRecording(id);
    if (!existing) throw new Error('Recording not found');
    const db = await this._db();
    const copy = {
      id: `rec_${Date.now()}`,
      blob: existing.blob,
      meta: { ...existing.meta, title: (existing.meta.title || existing.meta.environment || 'Recording') + ' copy' },
      createdAt: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').put(copy);
      tx.oncomplete = () => resolve(copy.id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async listRecordings() {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly');
      const req = tx.objectStore('recordings').getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  }

  async deleteRecording(id) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Real, cross-device recording sync via Supabase Storage (blob) + Postgres
 * (metadata). Requires the Supabase JS CDN script and a filled-in
 * js/config.js (see docs/DEPLOY.md) — same switch that enables
 * SupabaseAuthProvider.
 */
class SupabaseStorageProvider {
  constructor(url, anonKey) {
    if (typeof window.supabase === 'undefined') {
      throw new Error('Supabase JS client not loaded — check the script tag in <head>.');
    }
    this.client = window.supabase.createClient(url, anonKey);
  }

  async _userId() {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) throw new Error('You must be signed in to save recordings to the cloud.');
    return session.user.id;
  }

  async saveRecording(blob, meta) {
    const userId = await this._userId();
    const id = crypto.randomUUID();
    const path = `${userId}/${id}.webm`;
    const { error: upErr } = await this.client.storage.from('recordings').upload(path, blob, {
      contentType: blob.type || 'video/webm',
    });
    if (upErr) throw new Error('Upload failed: ' + upErr.message);
    const { error: dbErr } = await this.client.from('recordings').insert({
      id, user_id: userId, storage_path: path,
      title: meta.title || null, environment: meta.environment || null, quality: meta.quality || null,
      meta,
    });
    if (dbErr) {
      // Don't leave an orphaned blob if the metadata row failed.
      await this.client.storage.from('recordings').remove([path]).catch(() => {});
      throw new Error('Save failed: ' + dbErr.message);
    }
    return id;
  }

  _rowToRecord(row, blob) {
    return { id: row.id, blob: blob || null, meta: { ...row.meta, title: row.title, environment: row.environment, quality: row.quality }, createdAt: new Date(row.created_at).getTime() };
  }

  async getRecording(id) {
    const { data: row, error } = await this.client.from('recordings').select('*').eq('id', id).single();
    if (error || !row) return null;
    const { data: signed, error: urlErr } = await this.client.storage.from('recordings').createSignedUrl(row.storage_path, 3600);
    if (urlErr) throw new Error('Could not access recording file: ' + urlErr.message);
    const res = await fetch(signed.signedUrl);
    const blob = await res.blob();
    return this._rowToRecord(row, blob);
  }

  async updateRecordingMeta(id, patch) {
    const { data: row, error } = await this.client.from('recordings').select('*').eq('id', id).single();
    if (error || !row) return null;
    const mergedMeta = { ...row.meta, ...patch };
    const { data: updated, error: updErr } = await this.client.from('recordings')
      .update({ meta: mergedMeta, title: patch.title !== undefined ? patch.title : row.title })
      .eq('id', id).select().single();
    if (updErr) throw new Error(updErr.message);
    return this._rowToRecord(updated);
  }

  async duplicateRecording(id) {
    const userId = await this._userId();
    const { data: row, error } = await this.client.from('recordings').select('*').eq('id', id).single();
    if (error || !row) throw new Error('Recording not found');
    const newId = crypto.randomUUID();
    const newPath = `${userId}/${newId}.webm`;
    const { error: copyErr } = await this.client.storage.from('recordings').copy(row.storage_path, newPath);
    if (copyErr) throw new Error('Duplicate failed: ' + copyErr.message);
    const newTitle = (row.title || row.environment || 'Recording') + ' copy';
    const { error: dbErr } = await this.client.from('recordings').insert({
      id: newId, user_id: userId, storage_path: newPath,
      title: newTitle, environment: row.environment, quality: row.quality,
      meta: { ...row.meta, title: newTitle },
    });
    if (dbErr) throw new Error(dbErr.message);
    return newId;
  }

  async listRecordings() {
    const userId = await this._userId();
    const { data: rows, error } = await this.client.from('recordings').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return rows.map((row) => this._rowToRecord(row, null));
  }

  async deleteRecording(id) {
    const { data: row } = await this.client.from('recordings').select('storage_path').eq('id', id).single();
    if (row) await this.client.storage.from('recordings').remove([row.storage_path]).catch(() => {});
    const { error } = await this.client.from('recordings').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}

window.VS = window.VS || {};
window.VS.LocalStorageProvider = LocalStorageProvider;
window.VS.SupabaseStorageProvider = SupabaseStorageProvider;
