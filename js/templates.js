/**
 * Templates / Brand Kit — saves a full Studio configuration (environment,
 * quality, framing, realism settings, and an optional brand color + logo
 * watermark) as a named preset you can re-apply in one click. Pure
 * localStorage, no server, no account required beyond the local one.
 */
(function () {
  const KEY = 'vs_templates';

  function list() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }

  function save(template) {
    const templates = list();
    const record = { id: template.id || `tpl_${Date.now()}`, createdAt: Date.now(), ...template };
    const idx = templates.findIndex(t => t.id === record.id);
    if (idx >= 0) templates[idx] = record; else templates.push(record);
    localStorage.setItem(KEY, JSON.stringify(templates));
    return record.id;
  }

  function remove(id) {
    localStorage.setItem(KEY, JSON.stringify(list().filter(t => t.id !== id)));
  }

  function get(id) {
    return list().find(t => t.id === id) || null;
  }

  window.VS = window.VS || {};
  window.VS.templates = { list, save, remove, get };
})();
