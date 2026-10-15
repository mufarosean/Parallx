// raw-deep.js — a camera raw at full depth for the Image Editor and painting
// plans. The bundled magick's LibRaw develops the raw at 16 bits per channel
// (a binary PPM); this turns it into half floats, RGBA, which the engine
// uploads as an RGBA16F texture, so every control works on the raw's own
// levels rather than a JPEG's 256. Also: a piece of such a picture (a save's
// tile), removal patches laid over it, and a 16-bit PPM of a rendered picture
// for a 16-bit TIFF. No DOM here.
//
// A deep picture is { width, height, half: Uint16Array (RGBA half floats,
// rows top to bottom), deep: true }.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A number as an IEEE half float's bits (round to nearest). */
export function moHalfOf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  return sign | ((e << 10) + ((m + 0x1000) >> 13));
}

/** A half float's bits as a number (for tests and checks). */
export function moHalfValue(h) {
  const e = (h >> 10) & 0x1f, m = h & 0x3ff, s = h & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

let T16 = null, T8 = null;
function tables() {
  if (!T16) {
    T16 = new Uint16Array(65536);
    for (let i = 0; i < 65536; i++) T16[i] = moHalfOf(i / 65535);
    T8 = new Uint16Array(256);
    for (let i = 0; i < 256; i++) T8[i] = moHalfOf(i / 255);
  }
  return { T16, T8 };
}
const ONE = 0x3c00; // 1.0 as a half

/** A binary PPM (P6, 8 or 16 bits) as a deep picture, or null when it is not one. */
export function moDeepFromPpm(bytes) {
  let p = 0;
  const token = () => {
    while (p < bytes.length) {
      const c = bytes[p];
      if (c === 35) { while (p < bytes.length && bytes[p] !== 10) p++; } // a comment
      else if (c === 32 || c === 9 || c === 10 || c === 13) p++;
      else break;
    }
    let s = '';
    while (p < bytes.length && !(bytes[p] === 32 || bytes[p] === 9 || bytes[p] === 10 || bytes[p] === 13)) s += String.fromCharCode(bytes[p++]);
    return s;
  };
  if (token() !== 'P6') return null;
  const width = Number(token()), height = Number(token()), max = Number(token());
  p++; // the one whitespace after the maximum
  if (!(width > 0 && height > 0 && max > 0 && max < 65536)) return null;
  const n = width * height, wide = max > 255;
  if (bytes.length - p < n * 3 * (wide ? 2 : 1)) return null;
  const { T16, T8 } = tables();
  const half = new Uint16Array(n * 4);
  if (wide && max === 65535) {
    for (let i = 0, q = p, o = 0; i < n; i++, q += 6, o += 4) {
      half[o] = T16[(bytes[q] << 8) | bytes[q + 1]];
      half[o + 1] = T16[(bytes[q + 2] << 8) | bytes[q + 3]];
      half[o + 2] = T16[(bytes[q + 4] << 8) | bytes[q + 5]];
      half[o + 3] = ONE;
    }
  } else if (wide) {
    for (let i = 0, q = p, o = 0; i < n; i++, q += 6, o += 4) {
      for (let c = 0; c < 3; c++) half[o + c] = moHalfOf(((bytes[q + 2 * c] << 8) | bytes[q + 2 * c + 1]) / max);
      half[o + 3] = ONE;
    }
  } else {
    for (let i = 0, q = p, o = 0; i < n; i++, q += 3, o += 4) {
      half[o] = max === 255 ? T8[bytes[q]] : moHalfOf(bytes[q] / max);
      half[o + 1] = max === 255 ? T8[bytes[q + 1]] : moHalfOf(bytes[q + 1] / max);
      half[o + 2] = max === 255 ? T8[bytes[q + 2]] : moHalfOf(bytes[q + 2] / max);
      half[o + 3] = ONE;
    }
  }
  return { width, height, half, deep: true };
}

/** The part (x, y, w, h) of a deep picture, as a deep picture of its own. */
export function moDeepCrop(d, x, y, w, h) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const W = Math.max(1, Math.min(d.width - x0, Math.round(w))), H = Math.max(1, Math.min(d.height - y0, Math.round(h)));
  const half = new Uint16Array(W * H * 4);
  for (let r = 0; r < H; r++) half.set(d.half.subarray(((y0 + r) * d.width + x0) * 4, ((y0 + r) * d.width + x0 + W) * 4), r * W * 4);
  return { width: W, height: H, half, deep: true };
}

/**
 * The deep picture with 8-bit pixels laid over it: `boxes` are { x, y, w, h,
 * data } (RGBA bytes of that box, as a canvas's getImageData gives them), the
 * removals' patches already laid over the photo. A new picture; `d` is kept.
 */
export function moDeepWithBoxes(d, boxes) {
  const { T8 } = tables();
  const half = d.half.slice();
  for (const b of boxes) {
    for (let r = 0; r < b.h; r++) {
      const y = b.y + r;
      if (y < 0 || y >= d.height) continue;
      for (let c = 0; c < b.w; c++) {
        const x = b.x + c;
        if (x < 0 || x >= d.width) continue;
        const i = (r * b.w + c) * 4, o = (y * d.width + x) * 4;
        half[o] = T8[b.data[i]]; half[o + 1] = T8[b.data[i + 1]]; half[o + 2] = T8[b.data[i + 2]];
      }
    }
  }
  return { width: d.width, height: d.height, half, deep: true };
}

/**
 * A 16-bit binary PPM filled a tile at a time, for magick to write as a
 * 16-bit TIFF: moPpm16Begin makes it, moPpm16Put lays a tile of RGBA floats
 * (0..1, rows top to bottom) at (tx, ty).
 */
export function moPpm16Begin(width, height) {
  const head = new TextEncoder().encode(`P6\n${width} ${height}\n65535\n`);
  const bytes = new Uint8Array(head.length + width * height * 6);
  bytes.set(head, 0);
  return { bytes, head: head.length, width, height };
}
export function moPpm16Put(ppm, rgbaFloat, tx, ty, tw, th) {
  for (let r = 0; r < th; r++) {
    let o = ppm.head + ((ty + r) * ppm.width + tx) * 6;
    for (let c = 0; c < tw; c++) {
      const i = (r * tw + c) * 4;
      for (let k = 0; k < 3; k++, o += 2) {
        const v = Math.max(0, Math.min(65535, Math.round(rgbaFloat[i + k] * 65535)));
        ppm.bytes[o] = v >> 8; ppm.bytes[o + 1] = v & 0xff;
      }
    }
  }
}
/** A whole picture's RGBA floats as a 16-bit binary PPM. */
export function moPpm16(rgbaFloat, width, height) {
  const ppm = moPpm16Begin(width, height);
  moPpm16Put(ppm, rgbaFloat, 0, 0, width, height);
  return ppm.bytes;
}
