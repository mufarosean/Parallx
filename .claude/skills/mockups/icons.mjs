// icons.mjs — the app's icons (lucide-static) as the JSON object the mock-up kit's ICONS expects.
//   node .claude/skills/mockups/icons.mjs table folder file-text chevron-down > icons.json
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(import.meta.dirname, '../../../node_modules/lucide-static/icons');
const out = {};
for (const name of process.argv.slice(2)) {
  const file = path.join(dir, `${name}.svg`);
  if (!fs.existsSync(file)) { console.error(`no icon named ${name}`); continue; }
  out[name] = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[^>]*>/, '').replace('</svg>', '').replace(/\s+/g, ' ').trim();
}
process.stdout.write(JSON.stringify(out));
