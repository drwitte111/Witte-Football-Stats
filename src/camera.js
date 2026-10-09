// Camera stream setup and frame grabbing.

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available. Open this page over HTTPS.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  return stream;
}

// The part of the video frame that is visible on screen with
// object-fit: cover, in video pixel coordinates.
function visibleRegion(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cw = video.clientWidth;
  const ch = video.clientHeight;
  const scale = Math.max(cw / vw, ch / vh);
  const sw = cw / scale;
  const sh = ch / scale;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, viewW: cw, viewH: ch };
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Grabs the visible part of the current video frame, downscaled so the long
// side is at most maxSide, converted to contrast-stretched grayscale.
// Returns the image as an 8-bit BMP plus the factor that maps frame pixels
// back to on-screen CSS pixels.
export function grabFrame(video, maxSide = 960) {
  const r = visibleRegion(video);
  const k = Math.min(1, maxSide / Math.max(r.sw, r.sh));
  const w = Math.max(1, Math.round(r.sw * k));
  const h = Math.max(1, Math.round(r.sh * k));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = toStretchedGray(data, w * h);
  return {
    image: encodeBmp8(gray, w, h),
    width: w,
    height: h,
    toScreen: r.viewW / w,
  };
}

function toStretchedGray(rgba, n) {
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    gray[i] = v;
    hist[v]++;
  }
  // Stretch the 1st..99th percentile range to 0..255.
  const cut = n * 0.01;
  let lo = 0; let hi = 255; let acc = 0;
  while (lo < 255 && (acc += hist[lo]) < cut) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < cut) hi--;
  if (hi - lo < 16) return gray;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round(((v - lo) * 255) / (hi - lo))));
  }
  for (let i = 0; i < n; i++) gray[i] = lut[gray[i]];
  return gray;
}

// Uncompressed 8-bit grayscale BMP. Much cheaper to produce than PNG, and
// Tesseract reads it directly.
function encodeBmp8(gray, w, h) {
  const rowSize = (w + 3) & ~3;
  const paletteSize = 256 * 4;
  const offset = 14 + 40 + paletteSize;
  const size = offset + rowSize * h;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4d; // "BM"
  dv.setUint32(2, size, true);
  dv.setUint32(10, offset, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true); // positive height: rows stored bottom-up
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 8, true);
  dv.setUint32(34, rowSize * h, true);
  dv.setUint32(46, 256, true);
  for (let i = 0; i < 256; i++) {
    const p = 54 + i * 4;
    buf[p] = i; buf[p + 1] = i; buf[p + 2] = i;
  }
  for (let y = 0; y < h; y++) {
    buf.set(gray.subarray(y * w, (y + 1) * w), offset + (h - 1 - y) * rowSize);
  }
  return buf;
}
