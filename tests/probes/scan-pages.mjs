// scan-pages.mjs: pictures of pages for the Read Anything probes, and the
// image-only PDFs made of them. A scan is a page with no text of its own:
// the words are printed on a canvas in the app's own window, saved as a
// JPEG, and wrapped in a PDF by hand.

export const PAGE_W = 1654; export const PAGE_H = 2339; // A4 at 200 dpi

/** In the page: a picture of a page with these lines printed on it, as a JPEG in base64. */
export const drawPage = ({ LINES, PAGE_W, PAGE_H }) => {
  const c = document.createElement('canvas');
  c.width = PAGE_W; c.height = PAGE_H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, PAGE_W, PAGE_H);
  g.fillStyle = '#111';
  for (const l of LINES) { g.font = `${l.size}px Georgia, serif`; g.fillText(l.text, 180, l.y); }
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
};

/** The page with a table on it: where the table and the line under it are printed, in the picture's pixels. */
export const TABLE = { x: 180, y: 520, w: 900, h: 210, rows: [['Age', 'Paid', 'Incurred'], ['108', '1.08', '1.04'], ['120', '1.05', '1.02']] };
export const PROSE_Y = 860;

/** In the page: a picture of a page with a captioned, ruled table and a line of text under it, as a JPEG in base64. */
export const drawTablePage = ({ TABLE, PROSE_Y, PAGE_W, PAGE_H }) => {
  const c = document.createElement('canvas');
  c.width = PAGE_W; c.height = PAGE_H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, PAGE_W, PAGE_H);
  g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 2;
  g.font = '60px Georgia, serif'; g.fillText('Appendix C', 180, 240);
  g.font = '40px Georgia, serif'; g.fillText('Factors are selected from the triangle below.', 180, 360);
  g.font = '36px Georgia, serif'; g.fillText('Table 3: Selected development factors', 180, 490);
  const rowH = TABLE.h / TABLE.rows.length, colW = TABLE.w / TABLE.rows[0].length;
  TABLE.rows.forEach((row, r) => row.forEach((text, col) => {
    g.strokeRect(TABLE.x + col * colW, TABLE.y + r * rowH, colW, rowH);
    g.font = `${r === 0 ? 'bold ' : ''}36px Georgia, serif`;
    g.fillText(text, TABLE.x + col * colW + 24, TABLE.y + r * rowH + rowH * 0.66);
  }));
  g.font = '40px Georgia, serif'; g.fillText('The Bondy method repeats the last selected factor.', 180, PROSE_Y);
  return c.toDataURL('image/jpeg', 0.86).split(',')[1];
};

/** An image-only PDF: each page is a JPEG and nothing else. `jpegs` is one picture or several. */
export function scanPdf(jpegs, w, h) {
  const pictures = Array.isArray(jpegs) ? jpegs : [jpegs];
  const head = (s) => Buffer.from(s, 'latin1');
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (b) => { parts.push(b); size += b.length; };
  push(head('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
  const obj = (n, body, stream) => {
    offsets[n] = size;
    push(head(`${n} 0 obj\n${body}\n`));
    if (stream) { push(head('stream\n')); push(stream); push(head('\nendstream\n')); }
    push(head('endobj\n'));
  };
  const content = head(`q 595 0 0 842 0 0 cm /Im0 Do Q`);
  // Objects 1 and 2 are the catalog and the page list; each page then takes three: itself, what it draws, its picture.
  const last = 2 + 3 * pictures.length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pictures.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pictures.length} >>`);
  pictures.forEach((jpeg, i) => {
    const n = 3 + 3 * i;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${n + 1} 0 R /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> >>`);
    obj(n + 1, `<< /Length ${content.length} >>`, content);
    obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  });
  const xref = size;
  let table = `xref\n0 ${last + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= last; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(head(`${table}trailer\n<< /Size ${last + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(parts);
}
