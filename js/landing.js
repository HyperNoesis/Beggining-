/** Landing page glue: before/after slider (only if real pictures exist), scene thumbnails, pilot request (mailto / WhatsApp, no server), optional pay link. */
(function () {
  const $ = (id) => document.getElementById(id), cfg = () => (window.VS && window.VS.config) || {}, biz = () => cfg().business || {};
  /** Build the pilot message and the contact link. Pure: returns {text, href|null, how}. */
  function pilotMessage(f, b) {
    const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
    const text = 'Genesis pilot request\nName: ' + clean(f.name, 80) + '\nUse: ' + clean(f.use, 60) + '\nPhone: ' + clean(f.phone, 60) + '\nNote: ' + clean(f.note, 400);
    const email = clean(b && b.email, 120), wa = String((b && b.whatsapp) || '').replace(/[^\d]/g, '');
    if (wa.length >= 8) return { text, href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(text), how: 'WhatsApp' };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { text, href: 'mailto:' + email + '?subject=' + encodeURIComponent('Genesis pilot request') + '&body=' + encodeURIComponent(text), how: 'email' };
    return { text, href: null, how: '' };
  }
  window.VS = window.VS || {}; window.VS.Landing = { pilotMessage };
  function init() {
    // before/after only when both real pictures load
    const b = new Image(), a = new Image(); let n = 0;
    const done = () => { if (++n < 2) return; if (b.naturalWidth && a.naturalWidth) { $('baBox').hidden = false; $('baFallback').hidden = true; } };
    b.onload = a.onload = done; b.onerror = a.onerror = () => { n = 99; }; b.src = 'assets/landing/before.jpg'; a.src = 'assets/landing/after.jpg';
    const rg = $('baRange'); if (rg) rg.addEventListener('input', () => { $('baBefore').style.clipPath = 'inset(0 ' + (100 - rg.value) + '% 0 0)'; });
    const th = $('sceneThumbs'); if (th) ['classroom', 'podcast', 'tech', 'library', 'terrace', 'talkshow'].forEach((s) => { const i = document.createElement('img'); i.loading = 'lazy'; i.alt = s + ' room'; i.src = 'assets/environments/scene-premium-' + s + '.jpg'; i.onerror = () => i.remove(); th.appendChild(i); });
    const probe = pilotMessage({}, biz()), form = $('pilotForm');
    if (probe.href) { form.hidden = false; $('pHow').textContent = 'This opens ' + probe.how + ' with your message ready to send. Nothing is stored by this page.'; } else $('pilotOff').hidden = false;
    form.addEventListener('submit', (e) => { e.preventDefault(); const m = pilotMessage({ name: $('pName').value, use: $('pUse').value, phone: $('pPhone').value, note: $('pNote').value }, biz()); if (m.href) location.href = m.href; });
    const pay = (cfg().payLinks || {}).pro; if (pay && /^https:\/\//.test(pay)) { const p = $('payBtn'); p.href = pay; p.hidden = false; p.rel = 'noopener'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
