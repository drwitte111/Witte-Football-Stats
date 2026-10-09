// Word tracking between OCR passes.
//
// Milestone 3: pass-through. The overlay shows the latest OCR pass as-is.
// Milestone 4 adds the stability rules (box matching and smoothing, a
// 2-pass grace period for missing words, 2-pass confirmation for new words
// and for text changes) behind this same interface.

export function createTracker() {
  let items = [];
  return {
    update(words) { items = words; },
    clear() { items = []; },
    get items() { return items; },
  };
}
