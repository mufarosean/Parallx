// xml.ts — a small XML element scanner for OOXML parts.
//
// OOXML parts are machine-written and regular; this scanner is enough and
// keeps the worksheet importer free of the DOM and of a parser dependency.
// parseXml gives a tree of XNode; child, children and deepText read it;
// escapeXml writes text back into XML.

export interface XNode {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: XNode[];
  text: string;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e] ?? m;
  });
}
export function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
}
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse an XML document into a tree. Element names lose their namespace prefix. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { appendText(stack[stack.length - 1], xml.slice(i)); break; }
    if (lt > i) appendText(stack[stack.length - 1], xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); appendText(stack[stack.length - 1], xml.slice(lt + 9, e < 0 ? n : e), true); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) { const e = xml.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const gt = findTagEnd(xml, lt);
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const sp = body.search(/[\s/]/);
    const name = localName(sp < 0 ? body : body.slice(0, sp));
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      const rest = body.slice(sp);
      while ((m = ATTR_RE.exec(rest)) !== null) attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    const node: XNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}
function findTagEnd(xml: string, lt: number): number {
  let q: string | null = null;
  for (let j = lt + 1; j < xml.length; j++) {
    const ch = xml[j];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '>') return j;
  }
  return xml.length - 1;
}
function appendText(node: XNode, s: string, raw = false): void {
  if (!s) return;
  node.text += raw ? s : decodeEntities(s);
}
export function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name);
}
export function children(node: XNode | undefined, name: string): XNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}
/** All text under a node, in document order (for rich strings and text boxes). */
export function deepText(node: XNode | undefined, only?: string): string {
  if (!node) return '';
  let out = '';
  const walk = (n: XNode): void => {
    if (!only || n.name === only) out += n.text;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

/** Text made safe inside an XML element or attribute. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
