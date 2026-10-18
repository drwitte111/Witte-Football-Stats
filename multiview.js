'use strict';

// 8-box multiview: paste a link into any box and it shows that page.
// Frames are sandboxed without popups or top navigation, so a page can't
// open new windows or redirect the app.
(() => {
  const BOXES = 8;
  const KEY = 'multiview';
  const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms';

  const root = document.getElementById('multiview');
  const grid = root.querySelector('.mv-grid');
  let links = [];
  try { links = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { links = []; }
  links = Array.from({ length: BOXES }, (_, i) => links[i] || '');

  function save() {
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
    if (host === 'twitch.tv' && /^\/[^/]+\/?$/.test(u.pathname)) {
      return `https://player.twitch.tv/?channel=${encodeURIComponent(u.pathname.replace(/\//g, ''))}&parent=${location.hostname}&muted=true`;
    }
    return href;
  }

  function hostOf(href) {
    try { return new URL(href).hostname.replace(/^www\./, ''); } catch (e) { return href; }
  }

  function boxHtml(i) {
    const href = links[i];
    if (!href) {
      return `<button type="button" class="mv-add" data-act="edit"><span>+</span><small>Box ${i + 1}</small></button>`;
    }
    return `
      <iframe src="${esc(embedUrl(href))}" sandbox="${SANDBOX}" referrerpolicy="no-referrer"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen loading="lazy" title="Box ${i + 1}"></iframe>
      <button type="button" class="mv-more" data-act="menu" aria-label="Box ${i + 1} options">•••</button>`;
  }

  function renderBox(i) {
    const box = grid.children[i];
    box.classList.toggle('filled', !!links[i]);
    box.innerHTML = boxHtml(i);
  }

  function render() {
    grid.innerHTML = links.map((_, i) => `<div class="mv-box" data-i="${i}"></div>`).join('');
    links.forEach((_, i) => renderBox(i));
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
    else if (act === 'clear') { links[i] = ''; save(); renderBox(i); if (grid.querySelector('.mv-box.on')) setSolo(null); }
    else if (act === 'solo') { closeOverlay(); setSolo(grid.classList.contains('solo') ? null : i); }
  });

  function setSolo(i) {
    grid.classList.toggle('solo', i != null);
    [...grid.children].forEach((b, j) => b.classList.toggle('on', j === i));
  }

  function open() {
    if (!grid.children.length) render();
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
    if (!links.some(Boolean) || !confirm('Clear all 8 boxes?')) return;
    links = links.map(() => ''); save(); setSolo(null); render();
  });
})();
