/**
 * Stacks are retired (docs/IMAGE_EDITOR.md, Stacks retired). A stack kept
 * photos under one card; it could be filled but never opened or undone, and a
 * copy whose original was deleted stayed out of every view for good. Every
 * photo is a card of its own, so nothing in Media Organizer may put a photo
 * under another one or leave a photo out of a view because of a stack.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ext = resolve(__dirname, '../../ext/media-organizer');
const src = readFileSync(resolve(ext, 'main.js'), 'utf8');
const manifest = readFileSync(resolve(ext, 'parallx-manifest.json'), 'utf8');

describe('stacks are retired', () => {
  it('no query reads or writes the stack tables', () => {
    expect(src).not.toMatch(/mo_stacks|mo_stack_members/);
  });

  it('nothing puts a copy under its original', () => {
    expect(src).not.toMatch(/moStackUnder|moStackSelected|moAutoStackByBasename|editStackCopies|stackCheckbox/);
  });

  it('no card carries a stack count', () => {
    expect(src).not.toMatch(/mo-card-stack-badge|mo-feed-stack|_stackCount|moGetStackMemberCount/);
  });

  it('the manifest offers no stack command and no stack setting', () => {
    expect(manifest).not.toMatch(/stack/i);
  });

  it('a saved copy and an upscaled copy carry the original\'s details', () => {
    const save = src.slice(src.indexOf('async function moEditSaveCopy('), src.indexOf('async function moEditSaveCopyOf('));
    expect(save).toMatch(/moIngestNewImage\(outPath\)/);
    expect(save).toMatch(/moTransferPhotoMetadata\(photoId, photo\.id, base\)/);
    const upscale = src.slice(src.indexOf('function showUpscaleDialog('), src.indexOf('function showUpscaleSetupDialog('));
    expect(upscale.length).toBeGreaterThan(0);
    expect(upscale).toMatch(/moTransferPhotoMetadata\(t\.item\.id, photo\.id, t\.basename\)/);
  });

  it('a migration releases what was in a stack and keeps the tables for older builds', () => {
    const dir = resolve(ext, 'db/migrations');
    const name = readdirSync(dir).find((f) => /_retire_stacks\.sql$/.test(f));
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve(dir, name as string), 'utf8').replace(/^--.*$/gm, '');
    expect(sql).toMatch(/DELETE FROM mo_stack_members;/);
    expect(sql).toMatch(/DELETE FROM mo_stacks;/);
    expect(sql).not.toMatch(/DROP TABLE/i);
    const later = readdirSync(dir).filter((f) => f > (name as string) && /mo_stack/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(later).toEqual([]);
  });
});
