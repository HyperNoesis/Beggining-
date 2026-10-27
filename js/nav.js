(function () {
  // Register the service worker once per page load, on every screen that
  // loads nav.js. Feature-detected, so browsers/contexts without SW
  // support (or plain http:// during local dev) just skip it silently.
  //
  // updateViaCache: 'none' is load-bearing, not decorative — without it,
  // the browser's own HTTP cache can decide whether to even check for a
  // new sw.js, so bumping SHELL_CACHE in sw.js is not guaranteed to reach
  // an existing visitor on its own. This forces every registration check
  // to fetch sw.js fresh over the network.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((err) => {
        console.warn('Genesis: service worker registration failed', err);
      });
    });

    // Once a new service worker takes over (after skipWaiting +
    // clients.claim in sw.js), reload once so every open tab actually
    // gets the new shell instead of continuing to run old cached JS
    // against a page that already updated underneath it.
    let refreshedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshedOnce) return;
      refreshedOnce = true;
      window.location.reload();
    });
  }

  const LINKS = [
    { id: 'home', href: 'home.html', label: 'Home', icon: 'home' },
    { id: 'studio', href: 'studio.html', label: 'Studio', icon: 'studio' },
    { id: 'call', href: 'call.html', label: 'Live Call', icon: 'users' },
    { id: 'environments', href: 'environments.html', label: 'Environments', icon: 'environments' },
    { id: 'editor', href: 'editor.html', label: 'Editor', icon: 'layers' },
    { id: 'audio', href: 'audio.html', label: 'Audio', icon: 'audio' },
    { id: 'projects', href: 'projects.html', label: 'Projects', icon: 'projects' },
    { id: 'settings', href: 'settings.html', label: 'Settings', icon: 'settings' },
  ];

  const CMDK_ACTIONS = [
    { label: 'Open Studio', icon: 'studio', href: 'studio.html' },
    { label: 'Start camera in Studio', icon: 'video', href: 'studio.html?action=start' },
    { label: 'Start a live call', icon: 'users', href: 'call.html' },
    { label: 'Choose an environment', icon: 'environments', href: 'environments.html' },
    { label: 'Open Editor', icon: 'layers', href: 'editor.html' },
    { label: 'Open Audio Studio', icon: 'audio', href: 'audio.html' },
    { label: 'Open Projects', icon: 'projects', href: 'projects.html' },
    { label: 'Open Settings', icon: 'settings', href: 'settings.html' },
    { label: 'Enter Focus mode', icon: 'maximize', href: 'studio.html?action=focus' },
    { label: 'Go home', icon: 'home', href: 'home.html' },
  ];

  function buildSidebar(user, activePage) {
    const ic = window.VS.icon;
    return `
      <div class="sidebar">
        <div class="sidebar-logo">
          <img src="assets/logo-mark.png" alt="Rejuvini" class="brand-mark">
          <div>
            <div class="brand-name">Genesis</div>
            <div class="brand-sub">by Rejuvini</div>
          </div>
        </div>
        <nav aria-label="Primary">
          ${LINKS.map(l => `
            <a class="nav-link ${l.id === activePage ? 'active' : ''}" href="${l.href}" ${l.id === activePage ? 'aria-current="page"' : ''}>
              ${ic(l.icon, 18)}<span>${l.label}</span>
            </a>
          `).join('')}
        </nav>
        <a class="sidebar-create" href="studio.html"><span class="create-mark">+</span><span><b>Create</b><small>Open Studio</small></span><span class="create-kbd">⌘K</span></a>
        <div class="sidebar-cmdk" id="openCmdk" role="button" tabindex="0" aria-label="Open quick actions (Command K)">
          <span>Quick actions</span>
          <span class="kbd">⌘K</span>
        </div>
        <div class="sidebar-user">
          <div class="avatar">${user.name.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${user.name}</div>
            <button id="navSignOut" class="link-btn">Sign out</button>
          </div>
        </div>
      </div>
    `;
  }

  function buildMobileTopbar(user) {
    const ic = window.VS.icon;
    return `
      <div class="mobile-topbar">
        <div class="brand-mini">
          <img src="assets/logo-mark.png" alt="Rejuvini">
          <span>Genesis</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <button class="icon-btn" id="openCmdkMobile" aria-label="Open quick actions" style="background:transparent;border:1px solid var(--border);width:34px;height:34px;border-radius:8px;color:var(--text-dim);display:flex;align-items:center;justify-content:center;">${ic('search', 16)}</button>
          <div class="avatar" id="mobileAvatar" role="button" tabindex="0" aria-label="Account menu, signed in as ${user.name}" style="cursor:pointer;">${user.name.charAt(0).toUpperCase()}</div>
        </div>
      </div>
    `;
  }

  function buildBottomTabbar(activePage) {
    const ic = window.VS.icon;
    return `
      <nav class="bottom-tabbar" aria-label="Primary">
        ${LINKS.map(l => `<a class="${l.id === activePage ? 'active' : ''}" href="${l.href}" ${l.id === activePage ? 'aria-current="page"' : ''}>${ic(l.icon, 20)}<span>${l.label}</span></a>`).join('')}
      </nav>
    `;
  }

  function buildCmdk() {
    const ic = window.VS.icon;
    return `
      <div class="cmdk-overlay" id="cmdkOverlay" role="dialog" aria-modal="true" aria-label="Quick actions">
        <div class="cmdk-box">
          <div class="cmdk-input-row">
            ${ic('search', 17)}
            <input type="text" id="cmdkInput" placeholder="Jump to a screen or action..." aria-label="Jump to a screen or action" role="combobox" aria-expanded="true" aria-controls="cmdkList">
          </div>
          <div class="cmdk-list" id="cmdkList" role="listbox"></div>
        </div>
      </div>
    `;
  }

  function wireCmdk(user) {
    const overlay = document.getElementById('cmdkOverlay');
    const input = document.getElementById('cmdkInput');
    const list = document.getElementById('cmdkList');
    if (!overlay) return;

    function renderList(query) {
      const q = (query || '').toLowerCase();
      const items = CMDK_ACTIONS.filter(a => a.label.toLowerCase().includes(q));
      if (items.length === 0) {
        list.innerHTML = `<div class="cmdk-empty">No matches. Try "studio" or "settings".</div>`;
        return;
      }
      list.innerHTML = items.map((a, i) => `
        <div class="cmdk-item ${i === 0 ? 'active' : ''}" data-href="${a.href}">
          ${window.VS.icon(a.icon, 16)}<span>${a.label}</span>
        </div>
      `).join('');
      list.querySelectorAll('.cmdk-item').forEach(el => {
        el.addEventListener('click', () => { window.location.href = el.dataset.href; });
        el.addEventListener('mouseenter', () => {
          list.querySelectorAll('.cmdk-item').forEach(x => x.classList.remove('active'));
          el.classList.add('active');
        });
      });
    }

    function open() {
      overlay.classList.add('open');
      input.value = '';
      renderList('');
      setTimeout(() => input.focus(), 30);
    }
    function close() { overlay.classList.remove('open'); }

    ['openCmdk', 'openCmdkMobile'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', open);
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      }
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        const active = list.querySelector('.cmdk-item.active') || list.querySelector('.cmdk-item');
        if (active) window.location.href = active.dataset.href;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(list.querySelectorAll('.cmdk-item'));
        if (!items.length) return;
        let idx = items.findIndex(i => i.classList.contains('active'));
        items[idx]?.classList.remove('active');
        idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[idx].classList.add('active');
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        overlay.classList.contains('open') ? close() : open();
      }
    });

    const mobileAvatar = document.getElementById('mobileAvatar');
    if (mobileAvatar) {
      const signOutFlow = () => {
        if (confirm(`Signed in as ${user.name}. Sign out?`)) {
          window.VS.auth.signOut().then(() => window.location.href = 'auth.html');
        }
      };
      mobileAvatar.addEventListener('click', signOutFlow);
      mobileAvatar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); signOutFlow(); } });
    }
  }

  /**
   * Renders the sidebar/mobile nav AND gates the page: awaits the current
   * user, redirects to auth.html if there isn't one, and returns the
   * resolved user so the calling page can use it without a second check.
   */
  async function renderNav(activePage) {
    const user = await window.VS.auth.requireAuth();
    if (!user) return null;

    const root = document.getElementById('nav-root');
    root.innerHTML =
      buildMobileTopbar(user) +
      buildSidebar(user, activePage) +
      buildBottomTabbar(activePage) +
      buildCmdk();

    document.querySelectorAll('#navSignOut').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.VS.auth.signOut();
        window.location.href = 'auth.html';
      });
    });

    wireCmdk(user);
    return user;
  }

  window.VS = window.VS || {};
  window.VS.renderNav = renderNav;
})();
