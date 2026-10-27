/** Renders docs/PRIVACY.md or docs/TERMS.md as a page and fills business details from VS.config.business.
 *  While anything is missing it shows a visible "not ready to publish" banner (placeholders are never hidden). Pure helpers exported for tests. */
(function () {
  window.VS = window.VS || {};
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>'); }
  /** Fill known placeholders. Returns {text, missing:[names]} where text still contains any unfilled [PLACEHOLDER: ...]. */
  function fill(md, biz) {
    biz = biz || {}; const map = [[/\[PLACEHOLDER: Effective date\]/g, biz.effectiveDate, 'effective date'], [/\[PLACEHOLDER: legal entity \/ your name\]/g, biz.name, 'business name'], [/\[PLACEHOLDER: jurisdiction[^\]]*\]/g, biz.jurisdiction, 'jurisdiction'], [/\[PLACEHOLDER: contact email\]/g, biz.email, 'contact email']];
    let t = md; const missing = [];
    map.forEach(([re, v, n]) => { if (re.test(t)) { re.lastIndex = 0; if (v && String(v).trim()) t = t.replace(re, String(v).trim()); else missing.push(n); } });
    let probe = t; map.forEach(([re]) => { probe = probe.replace(re, ''); }); const left = (probe.match(/\[PLACEHOLDER:/g) || []).length; if (left) missing.push(left + ' other item' + (left > 1 ? 's' : '') + ' to write (for example the legal wording a lawyer should check)');
    return { text: t, missing };
  }
  /** Small markdown: #, ##, ###, paragraphs, - lists, **bold**, `code`, links. Multi-line paragraphs joined. */
  function render(md) {
    const out = []; let para = [], list = [];
    const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushL = () => { if (list.length) { out.push('<ul>' + list.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>'); list = []; } };
    md.split(/\r?\n/).forEach((line) => {
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushP(); flushL(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); }
      else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushP(); list.push(m[1]); }
      else if (/^\s+\S/.test(line) && list.length) { list[list.length - 1] += ' ' + line.trim(); }
      else if (!line.trim()) { flushP(); flushL(); }
      else { flushL(); para.push(line.trim()); }
    });
    flushP(); flushL(); return out.join('\n').replace(/\[PLACEHOLDER:([^\]]*)\]/g, '<mark class="ph">[to fill:$1]</mark>').replace(/<strong>(<mark class="ph">[\s\S]*?<\/mark>)<\/strong>/g, '$1');
  }
  async function show(file) {
    const root = document.getElementById('legalBody'), ban = document.getElementById('legalBanner'); if (!root) return;
    try {
      const md = await (await fetch(file, { cache: 'no-cache' })).text();
      const f = fill(md, (window.VS.config && window.VS.config.business) || {});
      root.innerHTML = render(f.text);
      if (f.missing.length) { ban.hidden = false; ban.textContent = 'Not ready to publish. Still missing: ' + f.missing.join('; ') + '. Fill js/config.js (business) and docs/*.md, and have a lawyer read the legal wording.'; }
    } catch (e) { root.textContent = 'Could not load this page. Check your connection and try again.'; }
  }
  window.VS.Legal = { fill, render, show, inline };
})();
