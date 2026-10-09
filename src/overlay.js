// Canvas overlay drawn over the video. Boxes are in on-screen CSS pixels.

const MIN_FONT = 11;
const MAX_GROW = 8; // px the box may widen before text shrinks further
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  let cssW = 0; let cssH = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawTranslation({ box, english }) {
    let x = box.x0;
    let w = box.x1 - box.x0;
    const y = box.y0;
    const h = box.y1 - box.y0;
    if (w < 2 || h < 2) return;

    let size = Math.max(MIN_FONT, h * 0.85);
    ctx.font = `600 ${size}px ${FONT}`;
    let textW = ctx.measureText(english).width;
    if (textW > w + MAX_GROW) {
      size = Math.max(MIN_FONT, size * ((w + MAX_GROW) / textW));
      ctx.font = `600 ${size}px ${FONT}`;
      textW = ctx.measureText(english).width;
    }
    // Text at the minimum size that still does not fit: grow the box.
    if (textW + 4 > w) {
      x -= (textW + 4 - w) / 2;
      w = textW + 4;
    }

    ctx.fillStyle = '#faf8f0';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#111';
    ctx.fillText(english, x + w / 2, y + h / 2);
  }

  function drawDebug({ box, text, confidence }) {
    const ok = confidence >= 60;
    ctx.strokeStyle = ok ? 'rgba(0, 220, 120, 0.9)' : 'rgba(255, 80, 80, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(`${text} ${Math.round(confidence)}`, box.x0 + (box.x1 - box.x0) / 2, box.y1 + 8);
  }

  return {
    draw(items, debugWords) {
      resize();
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const it of items) drawTranslation(it);
      if (debugWords) for (const w of debugWords) drawDebug(w);
    },
  };
}
