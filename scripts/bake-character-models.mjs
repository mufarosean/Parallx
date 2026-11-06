/**
 * bake-character-models.mjs
 *
 * Character Studio's anime characters (ext/character-studio/models/) are the
 * VRoid Project's sample characters, released CC0 / free to modify and
 * redistribute (each file's own VRM licence is read and kept). This copies
 * each .vrm with its textures re-encoded as WebP (alpha kept where the PNG has
 * it), which makes the files about a fifth of their size, and writes
 * models.json: id, name, kind, licence, source.
 *
 * Run: node scripts/bake-character-models.mjs <folder of .vrm files>
 * (ffmpeg on the PATH)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'ext', 'character-studio', 'models');

/** The characters and how the panel names them (file name -> id, display name). */
const CHARACTERS = {
  'AvatarSample_D.vrm': { id: 'shibu', name: 'Shibu' },
  'AvatarSample_E.vrm': { id: 'bibi', name: 'Bibi' },
  'AvatarSample_F.vrm': { id: 'vita', name: 'Vita' },
  'AvatarSample_G.vrm': { id: 'victoria', name: 'Victoria' },
  'HairSample_Female.vrm': { id: 'hana', name: 'Hana' },
  'HairSample_Male.vrm': { id: 'haru', name: 'Haru' },
  'Sakurada Fumiriya.vrm': { id: 'fumiriya', name: 'Fumiriya' },
  'Sendagaya Shino.vrm': { id: 'shino', name: 'Shino' },
};

function readGlb(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB.`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const binLen = b.readUInt32LE(binStart);
  return { json, bin: b.subarray(binStart + 8, binStart + 8 + binLen) };
}

function writeGlb(file, json, bin) {
  const pad = (buf, byte) => { const n = (4 - (buf.length % 4)) % 4; return n ? Buffer.concat([buf, Buffer.alloc(n, byte)]) : buf; };
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = pad(bin, 0);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([header, jh, j, bh, b]));
}

/** PNG colour type 4 or 6 has alpha. */
const pngHasAlpha = (bytes) => bytes.length > 26 && bytes.readUInt32BE(0) === 0x89504e47 && (bytes[25] === 4 || bytes[25] === 6);

function toWebp(bytes, alpha, work) {
  const src = join(work, 'in.png'); const dst = join(work, 'out.webp');
  writeFileSync(src, bytes);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c:v', 'libwebp', '-quality', '92', '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', dst]);
  return readFileSync(dst);
}

function bake(file, entry, work) {
  const { json, bin } = readGlb(file);
  const replaced = new Map();   // bufferView index -> new bytes
  for (const img of json.images || []) {
    if (img.bufferView === undefined || !/png/i.test(img.mimeType || '')) continue;
    const bv = json.bufferViews[img.bufferView];
    const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    replaced.set(img.bufferView, toWebp(bytes, pngHasAlpha(bytes), work));
    img.mimeType = 'image/webp';
  }
  // Repack every buffer view, 4-byte aligned
  const parts = []; let offset = 0;
  json.bufferViews.forEach((bv, i) => {
    const data = replaced.get(i) || bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
    bv.byteOffset = offset; bv.byteLength = data.length; bv.buffer = 0;
    parts.push(Buffer.from(data)); offset += data.length;
  });
  const out = Buffer.concat(parts);
  json.buffers = [{ byteLength: out.length }];
  writeGlb(join(OUT, `${entry.id}.vrm`), json, out);
  const m0 = json.extensions?.VRM?.meta; const m1 = json.extensions?.VRMC_vrm?.meta;
  const masc = /^M00_/.test((json.materials || [])[0]?.name || '');
  return {
    id: entry.id, name: entry.name, file: `models/${entry.id}.vrm`, kind: masc ? 'masculine' : 'feminine',
    title: (m0 && m0.title) || (m1 && m1.name) || entry.name,
    author: (m0 && m0.author) || ((m1 && m1.authors) || []).join(', '),
    licence: m0 ? (m0.licenseName === 'Other' ? m0.otherLicenseUrl : m0.licenseName) : m1 && m1.licenseUrl,
    source: basename(file), bytes: out.length,
  };
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Pass the folder of .vrm files.');
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'cs-models-'));
  const list = [];
  try {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.vrm')).sort()) {
      const entry = CHARACTERS[f];
      if (!entry) { console.log(`skipped ${f} (not in the list)`); continue; }
      const r = bake(join(dir, f), entry, work);
      console.log(`${f} -> ${r.file} ${(r.bytes / 1024 ** 2).toFixed(1)} MB (${r.kind})`);
      list.push(r);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  writeFileSync(join(OUT, 'models.json'), JSON.stringify({ format: 1, models: list }, null, 2) + '\n');
}

main();
