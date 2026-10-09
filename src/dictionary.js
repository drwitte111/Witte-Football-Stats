// Per-language word dictionaries: dict/<lang>.tsv, "foreign<TAB>english",
// lowercase, most frequent first.

const EDGE_PUNCT = /^[^\p{L}]+|[^\p{L}]+$/gu;
const WORD = /^\p{L}+(?:['’-]\p{L}+)*$/u;

export function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

export async function loadDictionary(lang) {
  const res = await fetch(new URL(`../dict/${lang}.tsv`, import.meta.url));
  if (!res.ok) throw new Error(`Dictionary for "${lang}" not found (${res.status})`);
  const text = await res.text();
  const exact = new Map();
  const plain = new Map();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const word = line.slice(0, tab);
    const english = line.slice(tab + 1).trim();
    if (!exact.has(word)) exact.set(word, english);
    // Rows are in frequency order, so the first unaccented match wins.
    const key = stripAccents(word);
    if (!plain.has(key)) plain.set(key, english);
  }
  return { lang, size: exact.size, lookup: (raw) => lookup(exact, plain, raw) };
}

function lookup(exact, plain, raw) {
  const core = raw.replace(EDGE_PUNCT, '');
  if (core.length < 2 || !WORD.test(core)) return null; // numbers, symbols, single letters
  const lower = core.toLocaleLowerCase();
  const english = exact.get(lower) ?? plain.get(stripAccents(lower));
  if (!english || english === lower) return null;
  return matchCase(core, english);
}

// Keep the look of the sign: SALIDA -> EXIT, Salida -> Exit.
function matchCase(original, english) {
  if (original.length > 1 && original === original.toLocaleUpperCase()) return english.toLocaleUpperCase();
  if (original[0] === original[0].toLocaleUpperCase()) return english[0].toLocaleUpperCase() + english.slice(1);
  return english;
}
