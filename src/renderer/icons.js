'use strict';
// Small stroke icon set (24x24, currentColor).
window.ICONS = (() => {
  const s = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  return {
    refresh: s('<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/>'),
    file: s('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    copy: s('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    download: s('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
    chevron: s('<path d="m6 9 6 6 6-6"/>'),
    help: s('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17h.01"/>'),
    settings: s('<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/><path d="M4 12h5"/><path d="M13 12h7"/><circle cx="11" cy="12" r="2"/>'),
    box: s('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>'),
    coffee: s('<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>'),
    code: s('<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13.5 5-3 14"/>'),
    package: s('<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M7.5 5.2 16.5 9.8"/><path d="M12 12v9"/><path d="m3 7.5 9 4.5 9-4.5"/>'),
    lock: s('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    search: s('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
    error: s('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
    warning: s('<path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
    info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
    ok: s('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3 4.7-5"/>'),
    loaded: s('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3 4.7-5"/>'),
    unknown: s('<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>'),
    folder: s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    wrench: s('<path d="M14.5 6.5a4.5 4.5 0 0 0 5.9 5.9L13 19.8a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>'),
    list: s('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
    sparkle: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
    java: s('<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/>'),
    python: s('<path d="M12 3c-4 0-4 1.7-4 3v2h4v1H6c-2 0-3 1.5-3 4s1 4 3 4h2v-2.5c0-1.5 1-2.5 2.5-2.5h4c1.4 0 2.5-1 2.5-2.5V6c0-1.5-1.5-3-5-3z"/><path d="M10 5.5h.01"/><path d="M12 21c4 0 4-1.7 4-3v-2h-4v-1h6c2 0 3-1.5 3-4"/><path d="M14 18.5h.01"/>'),
    ruby: s('<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M12 20 8 9l4-5 4 5z"/>'),
    external: s('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
    logo: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#3f7cf6"/></linearGradient></defs><rect x="3" y="3" width="58" height="58" rx="16" fill="url(#lg)"/><path d="M13 22h7.5a4.5 4.5 0 1 1 9 0H37v7.5a4.5 4.5 0 1 1 0 9V46H13z" fill="#fff" fill-opacity=".95"/><circle cx="44.5" cy="44.5" r="8" fill="#3f63e8" stroke="#fff" stroke-width="3.6"/><path d="m50.5 50.5 4.8 4.8" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/><path d="m41.3 44.6 2.2 2.2 4.1-4.4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
})();
