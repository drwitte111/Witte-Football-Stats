#!/usr/bin/env node
// Builds dict/<lang>.tsv (foreign<TAB>english, lowercase, most frequent first)
// from raw Wiktionary-derived source data. Raw downloads are not committed;
// see dict/SOURCES.md for where to get them.
//
// Usage: node scripts/build-dict.js es <path-to-spanish_data-clone> [maxRows]

'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MAX_WORDS = 2;
const MAX_CHARS = 18;

// Closed-class words where the frequency data (built from film subtitles)
// picks a reading that is wrong for signs and menus, e.g. "la" -> "her".
const OVERRIDES = {
  es: {
    el: 'the', la: 'the', los: 'the', las: 'the', lo: 'the',
    un: 'a', una: 'a', unos: 'some', unas: 'some',
    del: 'of the', al: 'to the',
    de: 'of', en: 'in', con: 'with', sin: 'without', por: 'for',
    para: 'for', que: 'that', se: 'itself', su: 'its', sus: 'its',
    mi: 'my', mis: 'my', tu: 'your', tus: 'your', nuestro: 'our', nuestra: 'our',
    muy: 'very', más: 'more', menos: 'less', también: 'also', pero: 'but',
    este: 'this', esta: 'this', estos: 'these', estas: 'these',
    ese: 'that', esa: 'that', esos: 'those', esas: 'those',
    es: 'is', son: 'are', está: 'is', están: 'are', hay: 'there is',
    sí: 'yes', si: 'if', ya: 'already', aquí: 'here', hoy: 'today',
    entrada: 'entrance', salida: 'exit', abierto: 'open', cerrado: 'closed',
    helado: 'ice cream', helados: 'ice cream',
  },
};

// Lemma-level fixes where Wiktionary's first sense is not the everyday one
// on a sign or menu. Inflected forms inherit these.
const LEMMA_OVERRIDES = {
  es: {
    n: { carne: 'meat', tienda: 'shop', pescado: 'fish', papa: 'potato',
      término: 'term', menú: 'menu', cena: 'dinner', bebida: 'drink',
      baño: 'bathroom', salón: 'hall', técnica: 'technique', plato: 'dish',
      entrada: 'entrance', salida: 'exit', cuenta: 'bill', postre: 'dessert',
      cerdo: 'pork', pollo: 'chicken', cordero: 'lamb', res: 'beef' },
    v: { tirar: 'pull', salir: 'leave', jalar: 'pull' },
    adj: { técnico: 'technical' },
  },
};

const POS_ORDER = ['n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'art',
  'determiner', 'num', 'contraction', 'interj', 'particle'];
const SKIP_POS = new Set(['prop', 'suffix', 'prefix', 'infix', 'interfix',
  'letter', 'symbol', 'abbrev', 'phrase', 'proverb', 'affix', 'none']);

const CLITIC_FORM = /(?:[áéíóú].*|r|ndo|d)(?:me|te|se|nos|os|lo|la|los|las|le|les)$/;
const FORM_OF = /\b(form|spelling|plural|participle|singular|feminine|masculine|diminutive|augmentative|superlative|abbreviation|initialism|acronym|clipping|ellipsis|apocopic|synonym|gerund|inflection|misspelling|variant)\s+of\b|\bof\s+"/i;
const NOT_A_TRANSLATION = /^(used|indicates?|forms?|denotes?|expresses|dependent|letter|name of|the letter|a letter|introduces?|marks?)\b/i;
const BAD_QUALIFIER = /\b(obsolete|archaic|rare|dated|vulgar|slang|derogatory|offensive|euphemistic|historical|figurative|pejorative|nonstandard|colloquial)\b/i;

function cleanSegment(seg, pos) {
  let s = seg.trim().toLowerCase();
  s = s.replace(/^(to be|to)\s+(?=\S+)/, (m) => (pos === 'v' ? (m.startsWith('to be') ? 'be ' : '') : m));
  if (s.split(/\s+/).length > 1) s = s.replace(/^(a|an|the)\s+/, '');
  s = s.replace(/\s+/g, ' ').replace(/[.!?:]+$/, '').trim();
  if (!/^[a-z][a-z' -]*[a-z]$|^[a-z]$/.test(s)) return null;
  if (s.split(' ').length > MAX_WORDS || s.length > MAX_CHARS) return null;
  return s;
}

function shortTranslation(gloss, pos) {
  if (FORM_OF.test(gloss) || NOT_A_TRANSLATION.test(gloss.trim())) return null;
  let g = gloss.replace(/\{\{[^}]*\}\}/g, '');
  for (let i = 0; i < 3; i++) g = g.replace(/\([^()]*\)/g, '');
  g = g.replace(/\[[^\]]*\]/g, '').replace(/["“”]/g, '');
  for (const seg of g.split(/[;,/]/)) {
    const s = cleanSegment(seg, pos);
    if (s) return s;
  }
  return null;
}

// es-en.data: entries separated by "_____", headword on the first line,
// then "pos:" sections with indented "gloss:" lines and "q:" qualifiers.
function parseWiktionaryData(file) {
  const out = new Map(); // headword -> Map(pos -> translation)
  const text = fs.readFileSync(file, 'utf8');
  for (const entry of text.split('_____\n')) {
    const lines = entry.split('\n');
    const head = lines[0].trim().toLowerCase();
    if (!head || /\s/.test(head)) continue;
    const sections = [];
    let cur = null; let lastGloss = null;
    for (const line of lines.slice(1)) {
      let m;
      if ((m = /^pos: (\S+)/.exec(line))) {
        cur = { pos: m[1], glosses: [] }; sections.push(cur); lastGloss = null;
      } else if (cur && (m = /^ {2}gloss: (.*)$/.exec(line))) {
        lastGloss = { text: m[1], q: '' }; cur.glosses.push(lastGloss);
      } else if (lastGloss && (m = /^ {4}q: (.*)$/.exec(line))) {
        lastGloss.q += ' ' + m[1];
      }
    }
    for (const sec of sections) {
      if (SKIP_POS.has(sec.pos)) continue;
      const byPos = out.get(head) || new Map();
      if (byPos.has(sec.pos)) continue;
      let t = null;
      for (const pass of [false, true]) {
        for (const g of sec.glosses) {
          if (!pass && BAD_QUALIFIER.test(g.q)) continue;
          t = shortTranslation(g.text, sec.pos);
          if (t) break;
        }
        if (t) break;
      }
      if (t) { byPos.set(sec.pos, t); out.set(head, byPos); }
    }
  }
  return out;
}

const UNCOUNTABLE = new Set(['seafood', 'fish', 'food', 'bread', 'rice', 'water',
  'milk', 'sheep', 'deer', 'information', 'furniture', 'equipment', 'money',
  'luggage', 'baggage', 'advice', 'news', 'people', 'police', 'staff']);
const IRREGULAR_PLURAL = { person: 'people', man: 'men', woman: 'women',
  child: 'children', foot: 'feet', tooth: 'teeth', mouse: 'mice',
  potato: 'potatoes', tomato: 'tomatoes', hero: 'heroes', knife: 'knives',
  leaf: 'leaves', life: 'lives', wife: 'wives', loaf: 'loaves', half: 'halves' };

function pluralize(en) {
  const words = en.split(' ');
  let w = words[words.length - 1];
  if (UNCOUNTABLE.has(w)) return en;
  if (Object.hasOwn(IRREGULAR_PLURAL, w)) w = IRREGULAR_PLURAL[w];
  else if (/(s|x|z|ch|sh)$/.test(w)) w += 'es';
  else if (/[^aeiou]y$/.test(w)) w = w.slice(0, -1) + 'ies';
  else w += 's';
  words[words.length - 1] = w;
  return words.join(' ');
}

function lookupLemma(glosses, lemma, pos) {
  const byPos = glosses.get(lemma);
  if (!byPos) return null;
  if (pos && byPos.has(pos)) return byPos.get(pos);
  if (pos) return null;
  for (const p of POS_ORDER) if (byPos.has(p)) return byPos.get(p);
  return null;
}

async function readLines(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) fn(line);
}

async function buildSpanish(rawDir, maxRows) {
  const glosses = parseWiktionaryData(path.join(rawDir, 'es-en.data'));
  for (const [pos, map] of Object.entries(LEMMA_OVERRIDES.es)) {
    for (const [lemma, t] of Object.entries(map)) {
      if (!glosses.has(lemma)) glosses.set(lemma, new Map());
      glosses.get(lemma).set(pos, t);
    }
  }
  console.error(`headwords with a short translation: ${glosses.size}`);

  // Form frequency (subtitle corpus, word forms).
  const formFreq = new Map();
  await readLines(path.join(rawDir, 'es_merged_50k.txt'), (line) => {
    const [w, c] = line.split(/\s+/);
    if (w && c) formFreq.set(w.toLowerCase(), Number(c));
  });

  // frequency.csv: lemma-level counts with the form -> lemma assignment.
  const formLemma = new Map(); // form -> {lemma, pos, count}
  const lemmaRank = new Map(); // lemma -> count
  await readLines(path.join(rawDir, 'frequency.csv'), (line) => {
    const [count, lemma, pos, , usage] = line.split(',');
    if (count === 'count' || !usage) return;
    if (!lemmaRank.has(lemma)) lemmaRank.set(lemma, Number(count));
    for (const u of usage.split('|')) {
      const [c, form] = u.split(':');
      const prev = formLemma.get(form);
      if (!prev || prev.count < Number(c)) formLemma.set(form, { lemma, pos, count: Number(c) });
    }
  });

  // es_allforms.csv: form,pos,lemma[,lemma...]. Keep form -> candidates,
  // and pick up every inflected form of the frequent lemmas.
  const formCandidates = new Map();
  const lemmaForms = new Map();
  await readLines(path.join(rawDir, 'es_allforms.csv'), (line) => {
    const parts = line.split(',');
    if (parts.length < 3) return;
    const form = parts[0].toLowerCase();
    if (/\s/.test(form)) return;
    const pos = parts[1];
    const lemmas = parts.slice(2);
    if (!formCandidates.has(form)) formCandidates.set(form, []);
    formCandidates.get(form).push({ pos, lemmas });
    // Verb forms with attached pronouns ("dámelo") rarely appear on signs.
    if (pos === 'v' && CLITIC_FORM.test(form)) return;
    for (const l of lemmas) {
      if (lemmaRank.has(l)) {
        if (!lemmaForms.has(l)) lemmaForms.set(l, new Set());
        lemmaForms.get(l).add(form);
      }
    }
  });

  const overrides = new Map(Object.entries(OVERRIDES.es));
  // Plural noun forms ("huevos" -> lemma "huevo") get an English plural.
  function nounForm(form, lemma, t) {
    if (form !== lemma && form.endsWith('s') && !lemma.endsWith('s') && !t.endsWith('s')) return pluralize(t);
    return t;
  }
  function translate(form) {
    if (overrides.has(form)) return overrides.get(form);
    const fl = formLemma.get(form);
    if (fl) {
      const t = lookupLemma(glosses, fl.lemma, fl.pos);
      if (t) return fl.pos === 'n' ? nounForm(form, fl.lemma, t) : t;
      const any = lookupLemma(glosses, fl.lemma);
      if (any) return any;
    }
    // The form as its own headword (e.g. "comida" n -> "food") before lemmas.
    const cands = (formCandidates.get(form) || []).slice()
      .sort((a, b) => rank(a.pos) - rank(b.pos));
    for (const c of cands) {
      const own = lookupLemma(glosses, form, c.pos);
      if (own) return own;
      for (const l of c.lemmas) {
        const t = lookupLemma(glosses, l, c.pos);
        if (t) return c.pos === 'n' ? nounForm(form, l, t) : t;
      }
    }
    return lookupLemma(glosses, form);
  }
  function rank(pos) { const i = POS_ORDER.indexOf(pos); return i < 0 ? 99 : i; }

  // Candidate forms, scored by observed frequency, falling back to a share
  // of the lemma's frequency for unobserved inflections (e.g. plurals).
  const score = new Map();
  for (const [f, c] of formFreq) score.set(f, c);
  for (const [lemma, forms] of lemmaForms) {
    const base = (lemmaRank.get(lemma) || 0) / 1000;
    for (const f of forms) if (!score.has(f)) score.set(f, base);
  }
  for (const f of overrides.keys()) if (!score.has(f)) score.set(f, 1e9);

  const rows = [];
  const ordered = [...score.entries()].sort((a, b) => b[1] - a[1]);
  for (const [form] of ordered) {
    if (rows.length >= maxRows) break;
    if (form.length < 2) continue; // single letters are skipped at runtime
    if (!/^[a-záéíóúüñ]+$/.test(form)) continue;
    const t = translate(form);
    if (!t || t === form) continue; // identical word: leave the original visible
    rows.push(`${form}\t${t}`);
  }
  return rows;
}

const BUILDERS = { es: buildSpanish };

async function main() {
  const [lang, rawDir, max] = process.argv.slice(2);
  if (!BUILDERS[lang] || !rawDir) {
    console.error(`usage: build-dict.js <${Object.keys(BUILDERS).join('|')}> <raw-dir> [maxRows]`);
    process.exit(1);
  }
  const rows = await BUILDERS[lang](rawDir, Number(max) || 60000);
  const outFile = path.join(__dirname, '..', 'dict', `${lang}.tsv`);
  fs.writeFileSync(outFile, rows.join('\n') + '\n');
  console.error(`wrote ${rows.length} rows to ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
