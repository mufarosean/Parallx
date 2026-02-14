/**
 * generate-ico.mjs — Create parallx.ico from the Layered Planes logo.
 *
 * Draws the logo programmatically at 16, 32, 48, and 256px sizes,
 * then packs them into a Windows .ico file.
 *
 * Usage: node scripts/generate-ico.mjs
 * Output: electron/parallx.ico
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Brand color: #a21caf
const R = 0xa2, G = 0x1c, B = 0xaf;

/**
 * Draw the Layered Planes logo into an RGBA buffer at the given size.
 * Matches the SVG: two rects with skewX(-8), rx=1.5, back at opacity 0.45.
 */
function drawLogo(size) {
  const buf = Buffer.alloc(size * size * 4, 0);

  // Blend a pixel with alpha compositing (src over dst)
  function blendPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    const srcA = a / 255;
    const dstA = buf[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA > 0) {
      buf[i]     = Math.round((r * srcA + buf[i]     * dstA * (1 - srcA)) / outA);
      buf[i + 1] = Math.round((g * srcA + buf[i + 1] * dstA * (1 - srcA)) / outA);
      buf[i + 2] = Math.round((b * srcA + buf[i + 2] * dstA * (1 - srcA)) / outA);
    }
    buf[i + 3] = Math.round(outA * 255);
  }

  // Anti-aliased sub-pixel rendering: sample NxN grid per pixel
  const AA = size >= 64 ? 4 : (size >= 32 ? 3 : 2);

  /**
   * Draw a rounded rect with SVG-compatible skewX transform.
   * SVG: <rect x y width height rx transform="skewX(angle)" fill opacity />
   * skewX(a) means: x' = x + y * tan(a), y' = y
   */
  function fillSkewedRoundRect(rx, ry, rw, rh, cornerR, skewDeg, r, g, b, alpha) {
    const s = size / 32; // scale from 32px SVG viewBox
    const tanA = Math.tan(skewDeg * Math.PI / 180);

    // Scale SVG coordinates to pixel space
    const sx = rx * s, sy = ry * s, sw = rw * s, sh = rh * s, sr = cornerR * s;

    // Determine bounding box in pixel space (with skew margin)
    const skewMargin = Math.abs(tanA) * size;
    const minX = Math.max(0, Math.floor(sx - skewMargin - 1));
    const maxX = Math.min(size - 1, Math.ceil(sx + sw + skewMargin + 1));
    const minY = Math.max(0, Math.floor(sy - 1));
    const maxY = Math.min(size - 1, Math.ceil(sy + sh + 1));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        // Sub-pixel sampling for anti-aliasing
        let coverage = 0;
        for (let sy2 = 0; sy2 < AA; sy2++) {
          for (let sx2 = 0; sx2 < AA; sx2++) {
            // Sample point in pixel space
            const sampleX = px + (sx2 + 0.5) / AA;
            const sampleY = py + (sy2 + 0.5) / AA;

            // Undo skew to get coordinates in rect's local space
            const localX = sampleX - sampleY * tanA;
            const localY = sampleY;

            // Check if inside the rounded rect
            const dx = localX - sx;
            const dy = localY - sy;

            if (dx >= 0 && dx <= sw && dy >= 0 && dy <= sh) {
              // Check rounded corners
              let inside = true;
              if (sr > 0) {
                // Distance from nearest corner center
                let cx, cy;
                if (dx < sr && dy < sr) { cx = sr; cy = sr; }
                else if (dx > sw - sr && dy < sr) { cx = sw - sr; cy = sr; }
                else if (dx < sr && dy > sh - sr) { cx = sr; cy = sh - sr; }
                else if (dx > sw - sr && dy > sh - sr) { cx = sw - sr; cy = sh - sr; }
                else { cx = -1; }

                if (cx >= 0) {
                  const dist = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2);
                  if (dist > sr) inside = false;
                }
              }
              if (inside) coverage++;
            }
          }
        }

        if (coverage > 0) {
          const pixelAlpha = Math.round(alpha * coverage / (AA * AA));
          blendPixel(px, py, r, g, b, pixelAlpha);
        }
      }
    }
  }

  // Back plane: <rect x="6" y="8" width="16" height="16" rx="1.5" transform="skewX(-8)" opacity="0.45"/>
  fillSkewedRoundRect(6, 8, 16, 16, 1.5, -8, R, G, B, Math.round(0.45 * 255));

  // Front plane: <rect x="10" y="6" width="16" height="16" rx="1.5" transform="skewX(-8)"/>
  fillSkewedRoundRect(10, 6, 16, 16, 1.5, -8, R, G, B, 255);

  return buf;
}

/**
 * Create a BMP image entry for the ICO (no file header, just DIB).
 * ICO uses bottom-up BGRA rows + a 1-bit AND mask.
 */
function createBmpEntry(rgbaBuf, size) {
  const rowBytes = size * 4; // BGRA pixels
  const maskRowBytes = Math.ceil(size / 8);
  const maskRowPadded = (maskRowBytes + 3) & ~3; // pad to 4-byte boundary
  const pixelDataSize = rowBytes * size;
  const maskDataSize = maskRowPadded * size;
  const dibHeaderSize = 40;
  const totalSize = dibHeaderSize + pixelDataSize + maskDataSize;

  const bmp = Buffer.alloc(totalSize);

  // BITMAPINFOHEADER (40 bytes)
  bmp.writeUInt32LE(40, 0);                    // biSize
  bmp.writeInt32LE(size, 4);                   // biWidth
  bmp.writeInt32LE(size * 2, 8);               // biHeight (×2 for XOR + AND)
  bmp.writeUInt16LE(1, 12);                    // biPlanes
  bmp.writeUInt16LE(32, 14);                   // biBitCount
  bmp.writeUInt32LE(0, 16);                    // biCompression (BI_RGB)
  bmp.writeUInt32LE(pixelDataSize + maskDataSize, 20); // biSizeImage
  // rest stays 0

  // Pixel data: bottom-up rows, BGRA order
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4; // flip vertically
    const dstRow = dibHeaderSize + y * rowBytes;
    for (let x = 0; x < size; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      bmp[di]     = rgbaBuf[si + 2]; // B
      bmp[di + 1] = rgbaBuf[si + 1]; // G
      bmp[di + 2] = rgbaBuf[si];     // R
      bmp[di + 3] = rgbaBuf[si + 3]; // A
    }
  }

  // AND mask: all 0 (fully opaque — alpha channel handles transparency)
  // Already zeroed by Buffer.alloc

  return bmp;
}

/**
 * Pack BMP entries into a .ico file.
 */
function createIco(sizes) {
  const entries = sizes.map(size => {
    const rgba = drawLogo(size);
    const bmp = createBmpEntry(rgba, size);
    return { size, bmp };
  });

  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * entries.length;
  let dataOffset = headerSize + dirSize;

  // ICO header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: 1 = ICO
  header.writeUInt16LE(entries.length, 4); // count

  // Directory entries
  const dirEntries = entries.map(({ size, bmp }) => {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);   // height (0 = 256)
    entry.writeUInt8(0, 2);                          // color count
    entry.writeUInt8(0, 3);                          // reserved
    entry.writeUInt16LE(1, 4);                       // color planes
    entry.writeUInt16LE(32, 6);                      // bits per pixel
    entry.writeUInt32LE(bmp.length, 8);              // data size
    entry.writeUInt32LE(dataOffset, 12);             // data offset
    dataOffset += bmp.length;
    return entry;
  });

  return Buffer.concat([header, ...dirEntries, ...entries.map(e => e.bmp)]);
}

// Generate and write
const ico = createIco([16, 32, 48, 256]);
const outPath = resolve(__dirname, '..', 'electron', 'parallx.ico');
writeFileSync(outPath, ico);
console.log(`✓ Written ${outPath} (${ico.length} bytes, 4 sizes: 16/32/48/256)`);
