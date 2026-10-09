# Witte Translator

Live camera word translator for the phone browser, in the spirit of Word Lens.
Point the rear camera at a sign or menu and the English word is drawn over
each foreign word it can read. Word-for-word dictionary lookup, no
translation API, runs entirely on the device.

Status: **milestone 3 of 8** — camera, continuous OCR, and Spanish
dictionary lookup with English drawn over the words. Ready for a first test
on a phone. See [the plan](#milestones).

## Try it on a phone

The camera only works over HTTPS. The quickest way is GitHub Pages:

1. Repo → **Settings → Pages**.
2. Source: **Deploy from a branch**, branch `claude/new-session-pb2cba`,
   folder `/ (root)`, Save.
3. Open `https://<user>.github.io/<repo>/` on the phone after a minute.
   (GitHub Pages on a private repo needs a paid plan; otherwise make the repo
   public or use another static host.)

First load downloads about 6 MB (OCR engine 3.9 MB, Spanish model 2 MB,
dictionary 1 MB).

### What to look at

- **Boxes** button: shows every word OCR found, with its confidence (green
  ≥ 60, red below). Useful to tell OCR misses from dictionary misses.
- Bottom-right numbers: frame size · time per OCR pass (avg) ·
  translated words / words found.
- URL knobs for tuning without code changes:
  - `?conf=50` — confidence threshold (default 60)
  - `?size=720` — frame long side in px (default 960; smaller is faster)
  - `?psm=3` — Tesseract page segmentation mode (default 11, sparse text;
    3 = automatic, may suit dense menus better)
  - `?debug` — start with boxes on

Known for this milestone: the overlay flickers and jumps between passes
(stability rules are milestone 4), boxes are a flat cream color (background
sampling is milestone 5), only Spanish is available, and there is no offline
support yet.

## Run locally

Any static server works; `localhost` counts as a secure context.

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Layout

```
index.html, styles.css
src/
  main.js        app start, OCR loop, wiring
  camera.js      stream setup, frame grab (visible region, grayscale, contrast)
  ocr.js         Tesseract.js worker; recognize(frame) -> [{ text, box, confidence }]
  dictionary.js  fetch + parse TSV, lookup (exact, then accent-stripped)
  tracker.js     pass-through for now; stability rules in milestone 4
  overlay.js     canvas drawing
  ui.js          language selector, freeze, debug toggle
dict/            one TSV per language (see dict/SOURCES.md)
vendor/tesseract Tesseract.js 7.0.0, LSTM-only cores, traineddata
scripts/build-dict.js
```

OCR sits behind `createOcr()` / `recognize(frame)` in `src/ocr.js`, so a
native port (ML Kit) only replaces the camera and OCR layers.

## Milestones

1. ✅ Camera feed full screen over HTTPS
2. ✅ OCR on frames, raw word boxes (Boxes button)
3. ✅ Spanish dictionary, English drawn over words
4. Stability rules (no flicker)
5. Background color sampling and text fitting
6. Language selector with all five languages
7. Service worker and offline test
8. Performance tuning on a real phone

## Licenses

- Tesseract.js and tesseract.js-core: Apache 2.0 (`vendor/tesseract/`).
- Spanish dictionary: CC BY-SA, derived from Wiktionary. See `dict/SOURCES.md`.
