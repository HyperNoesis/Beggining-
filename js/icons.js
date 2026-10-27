/**
 * Genesis icon set — small, original, stroke-based SVG glyphs.
 * No external icon library dependency (keeps the zero-build, zero-install
 * advantage intact). Usage: window.VS.icon('home', 18)
 */
(function () {
  const PATHS = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
    studio: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
    environments: '<rect x="3.5" y="3.5" width="17" height="12" rx="2"/><path d="M3.5 12.5 8 8l3.5 3.5L16 7l4.5 5"/><circle cx="8.2" cy="7.3" r="1.1"/>',
    projects: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17"/><path d="M9.5 13.3 13 15.2l-3.5 1.9z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.9 7.9 0 0 0 0-3l1.9-1.4-2-3.4-2.2.7a7.7 7.7 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.4a7.7 7.7 0 0 0-2.6 1.5l-2.2-.7-2 3.4L4.6 10.5a7.9 7.9 0 0 0 0 3L2.7 15l2 3.4 2.2-.7c.77.66 1.65 1.17 2.6 1.5l.5 2.4h4l.5-2.4a7.7 7.7 0 0 0 2.6-1.5l2.2.7 2-3.4z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M9 21h6"/>',
    micOff: '<path d="M3 3l18 18"/><path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-.4 1.5"/><path d="M15 9.8V14a3 3 0 0 1-4.6 2.5"/><path d="M5 11a7 7 0 0 0 10.2 6.2"/><path d="M19 11a7 7 0 0 1-.5 2.6"/><path d="M12 18v3"/><path d="M9 21h6"/>',
    video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M21 8.5l-6 3.5 6 3.5z"/>',
    gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/><path d="M12 15a1.4 1.4 0 1 0 0 .01"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h13M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    record: '<circle cx="12" cy="12" r="6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    maximize: '<path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6"/>',
    minimize: '<path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 19h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    command: '<path d="M8 6a2 2 0 1 1 2 2H6a2 2 0 1 1 2-2z"/><path d="M8 18a2 2 0 1 0 2-2H6a2 2 0 1 0 2 2z"/><path d="M16 6a2 2 0 1 0 2 2v-2z"/><path d="M16 18a2 2 0 1 1 2-2v2z"/><path d="M8 8h8v8H8z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/>',
    folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h9a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    lens: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    layers: '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 16.5 12 21l9-4.5"/>',
    audio: '<path d="M3 12h2l2-5 3 14 3-11 2 7 2-5h4"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    brush: '<path d="M9.5 14.5 4 20"/><path d="M13 4c2 0 7 1 7 5 0 3-3 4-5 4-1.5 0-2 1-2 2 0 2 2 3 2 3H9a3 3 0 0 1-3-3c0-3 2-5 4-7 1.3-1.3 2-2.6 2-4z"/>',
    captions: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M7 10.5h1.5M7 14h5"/><path d="M14.5 10.5c1 0 1.8.7 1.8 1.7M14.5 14c1 0 1.8-.7 1.8-1.7"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.4-1.9-.3-.7.1-1.6.9-1.7h1.2A3.5 3.5 0 0 0 19 14c0-6-3-11-7-11z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    loader: '<path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    users: '<circle cx="8.5" cy="8" r="3"/><path d="M2.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15 20c.2-2.6 1.7-4.6 3.8-5.3"/>',
    'phone-off': '<path d="M5 5l14 14"/><path d="M4.5 8.5c.6 4.5 4.5 8.4 9 9l2-2.3a1.3 1.3 0 0 0-.6-2.1l-2.6-.9a1.3 1.3 0 0 0-1.3.3l-.9.9a8 8 0 0 1-3.3-3.3l.9-.9a1.3 1.3 0 0 0 .3-1.3l-.9-2.6a1.3 1.3 0 0 0-2.1-.6z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a16.6 16.6 0 0 1-4 4.9M6.2 6.2C3.6 8 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.8"/><path d="M9.5 9.7a3 3 0 0 0 4.2 4.2"/>'
  };

  function icon(name, size, extraClass) {
    const inner = PATHS[name] || PATHS.close;
    const cls = extraClass ? ` class="${extraClass}"` : '';
    return `<svg${cls} width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }

  window.VS = window.VS || {};
  window.VS.icon = icon;
})();
