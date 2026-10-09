# Dictionary sources

## Spanish (`es.tsv`)

- Source: [doozan/spanish_data](https://github.com/doozan/spanish_data)
  - `es-en.data`: Spanish→English glosses extracted from English Wiktionary.
    License: CC BY-SA, attribution: wiktionary.org.
  - `es_allforms.csv`: every inflected form → lemma (from Wiktionary).
  - `frequency.csv`, `es_merged_50k.txt`: word frequencies from
    [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords),
    CC BY-SA 3.0.
- Because the glosses come from Wiktionary, `es.tsv` is a derived work and is
  distributed under **CC BY-SA**, with attribution to Wiktionary contributors.

kaikki.org was the first choice in the handoff but was not reachable from the
build environment; doozan/spanish_data is built from the same Wiktionary data.

### Rebuilding

```
git clone --depth 1 https://github.com/doozan/spanish_data raw/spanish_data
node scripts/build-dict.js es raw/spanish_data
```

`raw/` is git-ignored. The script keeps the 60,000 most frequent forms that
have a short (one or two word) translation, adds English plurals for plural
nouns, and applies a small list of overrides for words where the first
Wiktionary sense is wrong for menus and signs (e.g. `carne` → meat, not flesh).

## French, German, Italian, Portuguese

Not built yet (milestone 6). doozan/spanish_data covers Spanish only; the
other four need a Wiktionary extract (kaikki.org) or FreeDict, plus a builder
in `scripts/build-dict.js`.

## OCR models

`vendor/tesseract/lang/spa.traineddata.gz` comes from the npm package
`@tesseract.js-data/spa@1.0.0` (`4.0.0_best_int`), Apache 2.0, from the
[tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata) project.
