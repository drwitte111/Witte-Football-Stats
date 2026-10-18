'use strict';

// Multiview: choose 1-12 boxes, paste a link into any box and it shows that page.
// Frames are sandboxed without popups or top navigation, so a page can't
// open new windows or redirect the app.
(() => {
  const MAX = 12;
  const KEY = 'multiview';
  const COUNT_KEY = 'multiviewCount';
  // [columns, rows] for each box count.
  const PORTRAIT = [null, [1, 1], [1, 2], [1, 3], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [3, 3], [3, 4], [3, 4], [3, 4]];
  const LANDSCAPE = [null, [1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 2], [4, 2], [4, 2], [3, 3], [4, 3], [4, 3], [4, 3]];
  const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms';
  // Per-box opt-in: pop-ups (new tabs) allowed, and the page may navigate the
  // app only right after you tap inside it.
  const SANDBOX_POPUPS = `${SANDBOX} allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation`;
  const POPUP_KEY = 'multiviewPopups';

  const root = document.getElementById('multiview');
  const grid = root.querySelector('.mv-grid');
  let links = [];
  try { links = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { links = []; }
  links = Array.from({ length: MAX }, (_, i) => links[i] || '');

  let count = parseInt(localStorage.getItem(COUNT_KEY), 10);
  if (!(count >= 1 && count <= MAX)) {
    const lastFilled = links.reduce((n, l, i) => (l ? i + 1 : n), 0);
    count = lastFilled || 4;
  }
  const landscape = window.matchMedia('(orientation: landscape)');

  let popups = [];
  try { popups = JSON.parse(localStorage.getItem(POPUP_KEY)) || []; } catch (e) { popups = []; }
  popups = Array.from({ length: MAX }, (_, i) => !!popups[i]);

  function save() {
    try { localStorage.setItem(POPUP_KEY, JSON.stringify(popups)); } catch (e) { /* ignore */ }
    try { localStorage.setItem(KEY, JSON.stringify(links)); } catch (e) { /* ignore */ }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Accept "example.com/x" as well as full URLs; only http(s).
  function normalize(raw) {
    let s = String(raw || '').trim();
    if (!s || /\s/.test(s)) return '';
    if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
    try {
      const u = new URL(s);
      const okHost = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) || u.hostname === 'localhost';
      return (u.protocol === 'http:' || u.protocol === 'https:') && okHost ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  // Swap watch pages for their embeddable players where we know how.
  function embedUrl(href) {
    let u;
    try { u = new URL(href); } catch (e) { return href; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let yt = '';
    if (host === 'youtu.be') yt = u.pathname.slice(1);
    else if (host === 'youtube.com' && u.pathname === '/watch') yt = u.searchParams.get('v') || '';
    else if (host === 'youtube.com' && /^\/(live|shorts|embed)\//.test(u.pathname)) yt = u.pathname.split('/')[2];
    if (yt) return `https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1&playsinline=1`;
    // A channel's current live stream, when the link has the UC... channel id.
    const ch = host === 'youtube.com' && u.pathname.match(/^\/channel\/(UC[\w-]+)/);
    if (ch) return `https://www.youtube.com/embed/live_stream?channel=${ch[1]}&autoplay=1&mute=1&playsinline=1`;
    if (host === 'twitch.tv' && /^\/[^/]+\/?$/.test(u.pathname)) {
      return `https://player.twitch.tv/?channel=${encodeURIComponent(u.pathname.replace(/\//g, ''))}&parent=${location.hostname}&muted=true`;
    }
    return href;
  }

  // YouTube refuses to show its own pages (home, search, @channels) in a box.
  function notEmbeddable(href) {
    try {
      const u = new URL(href);
      const host = u.hostname.replace(/^www\.|^m\./, '');
      if ((host === 'youtube.com' || host === 'youtu.be') && !/youtube\.com\/embed\//.test(embedUrl(href))) {
        return 'YouTube only plays single videos or live streams in a box. Open the video, tap Share › Copy link, and paste that.';
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  function hostOf(href) {
    try { return new URL(href).hostname.replace(/^www\./, ''); } catch (e) { return href; }
  }

  function boxHtml(i) {
    const href = links[i];
    if (!href) {
      return `<button type="button" class="mv-add" data-act="edit"><span>+</span><small>Box ${i + 1}</small></button>`;
    }
    const why = notEmbeddable(href);
    if (why) {
      return `<div class="mv-note"><p>${esc(why)}</p><button type="button" data-act="edit">Change link</button></div>
        <button type="button" class="mv-more" data-act="menu" aria-label="Box ${i + 1} options">•••</button>`;
    }
    // Players such as YouTube's refuse to play without knowing the embedding
    // site, so send our origin (never the full URL).
    return `
      <iframe src="${esc(embedUrl(href))}" sandbox="${popups[i] ? SANDBOX_POPUPS : SANDBOX}" referrerpolicy="strict-origin-when-cross-origin"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen loading="lazy" title="Box ${i + 1}"></iframe>
      ${popups[i] ? '<span class="mv-badge">Pop-ups on</span>' : ''}
      <button type="button" class="mv-more" data-act="menu" aria-label="Box ${i + 1} options">•••</button>`;
  }

  function renderBox(i) {
    const box = grid.children[i];
    box.classList.toggle('filled', !!links[i]);
    box.innerHTML = boxHtml(i);
  }

  function applyLayout() {
    const solo = grid.classList.contains('solo');
    const [cols, rows] = solo ? [1, 1] : (landscape.matches ? LANDSCAPE : PORTRAIT)[count];
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    root.querySelector('.mv-count').textContent = `${count} ${count === 1 ? 'box' : 'boxes'}`;
    root.querySelector('[data-step="-1"]').disabled = count <= 1;
    root.querySelector('[data-step="1"]').disabled = count >= MAX;
  }

  // Add or remove boxes at the end; boxes that stay keep playing.
  function render() {
    while (grid.children.length > count) grid.lastElementChild.remove();
    while (grid.children.length < count) {
      const i = grid.children.length;
      const box = document.createElement('div');
      box.className = 'mv-box';
      box.dataset.i = String(i);
      grid.appendChild(box);
      renderBox(i);
    }
    if (grid.querySelector('.mv-box.on') == null) grid.classList.remove('solo');
    applyLayout();
  }

  function setCount(n) {
    count = Math.max(1, Math.min(MAX, n));
    try { localStorage.setItem(COUNT_KEY, String(count)); } catch (e) { /* ignore */ }
    closeOverlay();
    render();
  }

  function overlay(box, html) {
    closeOverlay();
    const el = document.createElement('div');
    el.className = 'mv-pop';
    el.innerHTML = html;
    box.appendChild(el);
    return el;
  }
  function closeOverlay() {
    grid.querySelectorAll('.mv-pop').forEach((el) => el.remove());
  }

  function editBox(i) {
    const box = grid.children[i];
    const pop = overlay(box, `
      <form class="mv-form" novalidate>
        <input type="text" inputmode="url" enterkeyhint="go" autocapitalize="none" autocorrect="off" spellcheck="false"
          placeholder="Paste a link" value="${esc(links[i])}">
        <div class="mv-actions">
          <button type="button" data-act="paste">Paste</button>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="submit" class="go">Show</button>
        </div>
        <p class="mv-err" hidden>That doesn't look like a web link.</p>
      </form>`);
    const input = pop.querySelector('input');
    const err = pop.querySelector('.mv-err');
    input.focus();
    pop.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const href = normalize(input.value);
      if (!href) { err.hidden = false; return; }
      links[i] = href; save(); renderBox(i);
    });
    pop.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') closeOverlay();
      if (act === 'paste') {
        try { input.value = (await navigator.clipboard.readText()).trim(); } catch (er) { input.focus(); }
      }
    });
  }

  function menuBox(i) {
    const box = grid.children[i];
    overlay(box, `
      <div class="mv-menu">
        <div class="mv-host">${esc(hostOf(links[i]))}</div>
        <button type="button" data-act="solo">${grid.classList.contains('solo') ? 'Back to grid' : 'Full screen'}</button>
        <button type="button" data-act="reload">Reload</button>
        <button type="button" data-act="edit">Change link</button>
        <a href="${esc(links[i])}" target="_blank" rel="noopener noreferrer">Open in Safari</a>
        <button type="button" data-act="popups" class="mv-toggle${popups[i] ? ' on' : ''}" aria-pressed="${popups[i]}">
          Allow pop-ups <i></i>
        </button>
        <button type="button" data-act="clear" class="danger">Clear</button>
        <button type="button" data-act="cancel">Close</button>
      </div>`);
  }

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const box = e.target.closest('.mv-box');
    if (!btn || !box) return;
    const i = Number(box.dataset.i);
    const act = btn.dataset.act;
    if (act === 'edit') editBox(i);
    else if (act === 'menu') menuBox(i);
    else if (act === 'cancel') closeOverlay();
    else if (act === 'reload') { closeOverlay(); renderBox(i); }
    else if (act === 'popups') { popups[i] = !popups[i]; save(); renderBox(i); }
    else if (act === 'clear') { links[i] = ''; popups[i] = false; save(); renderBox(i); if (grid.querySelector('.mv-box.on')) setSolo(null); }
    else if (act === 'solo') { closeOverlay(); setSolo(grid.classList.contains('solo') ? null : i); }
  });

  function setSolo(i) {
    grid.classList.toggle('solo', i != null);
    [...grid.children].forEach((b, j) => b.classList.toggle('on', j === i));
    applyLayout();
  }

  function open() {
    render();
    root.hidden = false;
    document.body.classList.add('noscroll');
  }
  function close() {
    root.hidden = true;
    closeOverlay();
    setSolo(null);
    document.body.classList.remove('noscroll');
  }

  document.getElementById('watch').addEventListener('click', open);
  root.querySelector('.mv-done').addEventListener('click', close);
  root.querySelector('.mv-clear-all').addEventListener('click', () => {
    if (!links.some(Boolean) || !confirm('Clear every box?')) return;
    links = links.map(() => ''); popups = popups.map(() => false); save(); setSolo(null);
    [...grid.children].forEach((_, i) => renderBox(i));
  });
  root.querySelector('.mv-stepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b && !b.disabled) setCount(count + Number(b.dataset.step));
  });
  landscape.addEventListener('change', () => { if (!root.hidden) applyLayout(); });
})();
