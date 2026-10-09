// App start and wiring: camera -> OCR loop -> dictionary -> tracker -> overlay.

import { startCamera, grabFrame } from './camera.js';
import { createOcr } from './ocr.js';
import { loadDictionary } from './dictionary.js';
import { createTracker } from './tracker.js';
import { createOverlay } from './overlay.js';
import { createUi, savedLanguage, LANGUAGES } from './ui.js';

// Tuning knobs, overridable from the URL for testing on a phone,
// e.g. ?conf=50&size=720&psm=3
const params = new URLSearchParams(location.search);
const CONFIDENCE_MIN = Number(params.get('conf') ?? 60);
const FRAME_SIZE = Number(params.get('size') ?? 960);
const PSM = params.get('psm') ?? '11';

const video = document.getElementById('video');
const overlay = createOverlay(document.getElementById('overlay'));
const tracker = createTracker();

const state = {
  ocr: null,
  dict: null,
  loading: true,
  frozen: false,
  debug: params.has('debug'),
  rawWords: [],
};

const ui = createUi({
  onLanguage: (code) => switchLanguage(code),
  onFreeze: (on) => {
    state.frozen = on;
    if (on) video.pause(); else video.play();
  },
  onDebug: (on) => { state.debug = on; },
});

function langName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

async function switchLanguage(code) {
  state.loading = true;
  ui.setBusy(true);
  tracker.clear();
  state.rawWords = [];
  ui.setStatus(`Loading ${langName(code)}…`);
  try {
    state.dict = null;
    const [dict] = await Promise.all([
      loadDictionary(code),
      state.ocr ? state.ocr.setLanguage(code) : null,
    ]);
    state.dict = dict;
    ui.setStatus(langName(code));
  } catch (err) {
    console.error(err);
    ui.setStatus(`Could not load ${langName(code)}: ${err.message}`);
  } finally {
    state.loading = false;
    ui.setBusy(false);
  }
}

// Screen-space box from OCR frame coordinates.
function toScreen(box, k) {
  return { x0: box.x0 * k, y0: box.y0 * k, x1: box.x1 * k, y1: box.y1 * k };
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One OCR job at a time; each job starts from the newest frame, so frames
// never queue up behind a slow pass.
async function ocrLoop() {
  let avg = 0;
  for (;;) {
    if (state.frozen || state.loading || !state.dict || video.readyState < 2) {
      await sleep(100);
      continue;
    }
    const t0 = performance.now();
    const frame = grabFrame(video, FRAME_SIZE);
    const dict = state.dict;
    let words;
    try {
      words = await state.ocr.recognize(frame);
    } catch (err) {
      console.error(err);
      await sleep(500);
      continue;
    }
    // Language changed or frozen while this pass ran: drop its result.
    if (dict !== state.dict || state.frozen) continue;

    const k = frame.toScreen;
    const screenWords = words.map((w) => ({ ...w, box: toScreen(w.box, k) }));
    state.rawWords = screenWords;
    const items = [];
    for (const w of screenWords) {
      if (w.confidence < CONFIDENCE_MIN) continue;
      const english = dict.lookup(w.text);
      if (english) items.push({ text: w.text, english, box: w.box, confidence: w.confidence });
    }
    tracker.update(items);

    const ms = performance.now() - t0;
    avg = avg ? avg * 0.8 + ms * 0.2 : ms;
    ui.setStats(`${frame.width}×${frame.height} · ${Math.round(ms)} ms (avg ${Math.round(avg)}) · ${items.length}/${words.length}`);
    await nextTick();
  }
}

function drawLoop() {
  overlay.draw(tracker.items, state.debug ? state.rawWords : null);
  requestAnimationFrame(drawLoop);
}

async function start() {
  const startScreen = document.getElementById('start');
  try {
    ui.setStatus('Starting camera…');
    await startCamera(video);
  } catch (err) {
    console.error(err);
    document.getElementById('start-msg').textContent =
      err.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access for this site, then try again.'
        : `Could not start the camera: ${err.message}`;
    startScreen.hidden = false;
    document.getElementById('start-btn').onclick = () => {
      startScreen.hidden = true;
      start();
    };
    return;
  }

  if (!state.ocr) {
    const code = savedLanguage();
    ui.setStatus(`Loading ${langName(code)}…`);
    try {
      const [ocr, dict] = await Promise.all([
        createOcr(code, {
          psm: PSM,
          onProgress: (m) => {
            if (state.loading && m.status && m.progress < 1) ui.setStatus(`${m.status} ${Math.round(m.progress * 100)}%`);
          },
        }),
        loadDictionary(code),
      ]);
      state.ocr = ocr;
      state.dict = dict;
      state.loading = false;
      ui.setStatus(langName(code));
    } catch (err) {
      console.error(err);
      ui.setStatus(`Could not load OCR: ${err.message}`);
      return;
    }
    requestAnimationFrame(drawLoop);
    ocrLoop();
  }
}

start();
