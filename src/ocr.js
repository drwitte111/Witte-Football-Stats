// OCR engine. Everything else talks to it through createOcr() and
// recognize(frame) -> [{ text, box: { x0, y0, x1, y1 }, confidence }],
// so the engine can be swapped (e.g. ML Kit in a native app) without
// touching the rest of the app.

import Tesseract from '../vendor/tesseract/tesseract.esm.min.js';

const base = new URL('../vendor/tesseract/', import.meta.url);

// App language code -> Tesseract traineddata name.
export const OCR_LANG = { es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por' };

export async function createOcr(lang, { psm = '11', onProgress } = {}) {
  const worker = await Tesseract.createWorker(OCR_LANG[lang], Tesseract.OEM.LSTM_ONLY, {
    workerPath: new URL('worker.min.js', base).href,
    corePath: new URL('core', base).href,
    langPath: new URL('lang', base).href.replace(/\/$/, ''),
    gzip: true,
    logger: (m) => onProgress?.(m),
  });
  const params = { tessedit_pageseg_mode: psm, user_defined_dpi: '300' };
  await worker.setParameters(params);

  let current = lang;
  return {
    get lang() { return current; },

    async setLanguage(next) {
      if (next === current) return;
      await worker.reinitialize(OCR_LANG[next], Tesseract.OEM.LSTM_ONLY);
      await worker.setParameters(params);
      current = next;
    },

    async recognize(frame) {
      const { data } = await worker.recognize(frame.image, {}, { text: false, blocks: true });
      const words = [];
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              const text = w.text.trim();
              if (text) words.push({ text, box: { ...w.bbox }, confidence: w.confidence });
            }
          }
        }
      }
      return words;
    },

    terminate() { return worker.terminate(); },
  };
}
