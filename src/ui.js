// Language selector, freeze button, debug toggle, status text.

export const LANGUAGES = [
  { code: 'es', name: 'Spanish', ready: true },
  { code: 'fr', name: 'French', ready: false },
  { code: 'de', name: 'German', ready: false },
  { code: 'it', name: 'Italian', ready: false },
  { code: 'pt', name: 'Portuguese', ready: false },
];

const STORAGE_KEY = 'witte.lang';

export function savedLanguage() {
  let code = null;
  try { code = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  const lang = LANGUAGES.find((l) => l.code === code && l.ready);
  return (lang || LANGUAGES[0]).code;
}

export function createUi({ onLanguage, onFreeze, onDebug }) {
  const select = document.getElementById('lang');
  const freezeBtn = document.getElementById('freeze');
  const debugBtn = document.getElementById('debug');
  const status = document.getElementById('status');
  const stats = document.getElementById('stats');

  for (const l of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.ready ? l.name : `${l.name} (soon)`;
    opt.disabled = !l.ready;
    select.append(opt);
  }
  select.value = savedLanguage();
  select.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, select.value); } catch { /* storage unavailable */ }
    onLanguage(select.value);
  });

  function toggle(btn, cb) {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      cb(on);
    });
  }
  toggle(freezeBtn, (on) => {
    freezeBtn.textContent = on ? 'Resume' : 'Freeze';
    onFreeze(on);
  });
  toggle(debugBtn, onDebug);

  return {
    setStatus(text) { status.textContent = text; },
    setStats(text) { stats.textContent = text; },
    setBusy(busy) { select.disabled = busy; },
  };
}
