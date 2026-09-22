// Office Math (OMML) → LaTeX.
//
// Excel stores an inserted equation as a shape whose Choice branch carries
// the maths as OMML and whose Fallback branch carries Excel's own linear
// rendering ("U_(0 )=", "∑_▒", "〖Ult〗_i"). The importer used to take the
// fallback, which is what a candidate saw in every Rising Fellow problem
// with a typed formula. This walks the OMML instead and emits LaTeX that
// the app's KaTeX renders; equationImage.ts turns that into the picture the
// sheet shows. The vocabulary covered is the vocabulary measured across the
// Rising Fellow workbooks (docs/ALPHA_UNIFICATION.md ledger): runs, sub and
// superscripts (including pre-scripts), fractions, radicals, n-ary operators
// with limits, delimiters, accents, functions, equation arrays, matrices,
// line breaks and plain-text runs.
import type { XNode } from './ooxml.js';

const child = (n: XNode | undefined, name: string): XNode | undefined => n?.children.find((c) => c.name === name);
const kids = (n: XNode | undefined, name: string): XNode[] => (n ? n.children.filter((c) => c.name === name) : []);
const val = (n: XNode | undefined): string | undefined => n?.attrs.val;
const on = (n: XNode | undefined): boolean => { const v = val(n); return v === '1' || v === 'on' || v === 'true'; };

/** Mathematical Alphanumeric Symbols (U+1D400 …) back to the letters Word italicised. */
function unstyleLetters(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1d400 && cp <= 0x1d6a3) {
      const i = (cp - 0x1d400) % 52;
      out += String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26);
    } else if (cp >= 0x1d6a8 && cp <= 0x1d7c9) {
      // Greek in the math-alphanumeric block: 58 per style (Α…Ω, ∇, α…ω, ∂, ϵ, ϑ, ϰ, ϕ, ϱ, ϖ)
      const i = (cp - 0x1d6a8) % 58;
      out += GREEK_BLOCK[i] ?? ch;
    } else if (cp >= 0x1d7ce && cp <= 0x1d7ff) {
      out += String((cp - 0x1d7ce) % 10);
    } else out += ch;
  }
  return out;
}
const GREEK_BLOCK = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ';

const SYMBOLS: Record<string, string> = {
  '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ', '·': '\\cdot ', '⋅': '\\cdot ', '⋯': '\\cdots ', '…': '\\ldots ',
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ', '∼': '\\sim ',
  '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ', '↔': '\\leftrightarrow ',
  '∞': '\\infty ', '∂': '\\partial ', '∇': '\\nabla ', '∈': '\\in ', '∉': '\\notin ', '∀': '\\forall ', '∃': '\\exists ',
  '∪': '\\cup ', '∩': '\\cap ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∅': '\\emptyset ', '′': "'", '″': "''", '°': '^{\\circ}',
  '−': '-', '–': '-', '—': '-', '∗': '*', '∘': '\\circ ', '√': '\\surd ', '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ',
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'ε': '\\varepsilon ', 'ϵ': '\\epsilon ', 'ζ': '\\zeta ', 'η': '\\eta ',
  'θ': '\\theta ', 'ϑ': '\\vartheta ', 'ι': '\\iota ', 'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ',
  'π': '\\pi ', 'ρ': '\\rho ', 'ϱ': '\\varrho ', 'σ': '\\sigma ', 'ς': '\\varsigma ', 'τ': '\\tau ', 'υ': '\\upsilon ', 'φ': '\\varphi ', 'ϕ': '\\phi ',
  'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ', 'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ', 'Ξ': '\\Xi ',
  'Π': '\\Pi ', 'Σ': '\\Sigma ', 'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega ', 'ϴ': '\\Theta ',
  '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '$': '\\$', '~': '\\sim ', '^': '\\hat{}',
};

/** A text run: letters stay letters (KaTeX italicises them), symbols become commands. */
function runText(text: string, plain: boolean): string {
  const s = unstyleLetters(text);
  if (plain) return `\\text{${s.replace(/[\\{}]/g, (m) => `\\${m}`)}}`;
  let out = '';
  for (const ch of s) {
    if (ch === ' ') out += '\\ ';
    else out += SYMBOLS[ch] ?? ch;
  }
  return out;
}

const NARY: Record<string, string> = { '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge' };
const ACCENT: Record<string, string> = { '̂': '\\hat', '̄': '\\bar', '̃': '\\tilde', '̇': '\\dot', '̈': '\\ddot', '⃗': '\\vec', '̆': '\\breve', '̌': '\\check', '́': '\\acute', '̀': '\\grave', '⃛': '\\dddot' };
const DELIM: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '〖': '.', '〗': '.' };

function delim(ch: string | undefined, dflt: string): string {
  if (ch === undefined) return dflt;
  if (ch === '') return '.';
  return DELIM[ch] ?? ch;
}

function group(s: string): string { return `{${s}}`; }

/** LaTeX for one OMML node and everything under it. */
export function ommlToLatex(node: XNode): string {
  switch (node.name) {
    case 'oMathPara': return kids(node, 'oMath').map(ommlToLatex).join(' \\\\ ');
    case 'oMath': case 'e': case 'sub': case 'sup': case 'num': case 'den': case 'deg': case 'fName': case 'lim':
      return node.children.map(ommlToLatex).join('');
    case 'r': {
      const pr = child(node, 'rPr');
      const plain = child(pr, 'nor') !== undefined || val(child(pr, 'sty')) === 'p';
      // A run is text pieces with optional line breaks between them.
      return node.children.map((c) => (c.name === 't' ? runText(c.text, plain) : c.name === 'brk' ? ' \\\\ ' : '')).join('');
    }
    case 't': return runText(node.text, false);
    case 'sSub': return `${group(sub(node, 'e'))}_${group(sub(node, 'sub'))}`;
    case 'sSup': return `${group(sub(node, 'e'))}^${group(sub(node, 'sup'))}`;
    case 'sSubSup': return `${group(sub(node, 'e'))}_${group(sub(node, 'sub'))}^${group(sub(node, 'sup'))}`;
    case 'sPre': return `{}_${group(sub(node, 'sub'))}^${group(sub(node, 'sup'))}${group(sub(node, 'e'))}`;
    case 'f': {
      const type = val(child(child(node, 'fPr'), 'type'));
      const n = sub(node, 'num'); const d = sub(node, 'den');
      if (type === 'lin' || type === 'skw') return `${group(n)}/${group(d)}`;
      if (type === 'noBar') return `\\genfrac{}{}{0pt}{}${group(n)}${group(d)}`;
      return `\\frac${group(n)}${group(d)}`;
    }
    case 'rad': {
      const hide = on(child(child(node, 'radPr'), 'degHide'));
      const deg = hide ? '' : sub(node, 'deg');
      return deg ? `\\sqrt[${deg}]${group(sub(node, 'e'))}` : `\\sqrt${group(sub(node, 'e'))}`;
    }
    case 'nary': {
      const pr = child(node, 'naryPr');
      const chr = val(child(pr, 'chr')) ?? '∫';
      const op = NARY[chr] ?? `\\operatorname*{${chr}}`;
      const under = val(child(pr, 'limLoc')) === 'undOvr';
      const lo = on(child(pr, 'subHide')) ? '' : sub(node, 'sub');
      const hi = on(child(pr, 'supHide')) ? '' : sub(node, 'sup');
      let s = op + (under ? '\\limits' : '');
      if (lo) s += `_${group(lo)}`;
      if (hi) s += `^${group(hi)}`;
      return `${s} ${sub(node, 'e')}`;
    }
    case 'd': {
      const pr = child(node, 'dPr');
      const beg = delim(val(child(pr, 'begChr')), '(');
      const end = delim(val(child(pr, 'endChr')), ')');
      const sep = val(child(pr, 'sepChr')) ?? '|';
      const parts = kids(node, 'e').map(ommlToLatex);
      const inner = parts.join(` \\middle${DELIM[sep] ?? sep} `);
      return `\\left${beg} ${inner} \\right${end}`;
    }
    case 'acc': {
      const chr = val(child(child(node, 'accPr'), 'chr')) ?? '̂';
      const cmd = ACCENT[chr] ?? '\\hat';
      return `${cmd}${group(sub(node, 'e'))}`;
    }
    case 'bar': {
      const pos = val(child(child(node, 'barPr'), 'pos'));
      return `${pos === 'top' ? '\\overline' : '\\underline'}${group(sub(node, 'e'))}`;
    }
    case 'box': case 'borderBox': case 'phant': return sub(node, 'e');
    case 'groupChr': {
      const pr = child(node, 'groupChrPr');
      const chr = val(child(pr, 'chr')) ?? '⏟';
      const pos = val(child(pr, 'pos'));
      const cmd = chr === '⏞' || pos === 'top' ? '\\overbrace' : '\\underbrace';
      return `${cmd}${group(sub(node, 'e'))}`;
    }
    case 'limLow': return `\\underset${group(sub(node, 'lim'))}${group(sub(node, 'e'))}`;
    case 'limUpp': return `\\overset${group(sub(node, 'lim'))}${group(sub(node, 'e'))}`;
    case 'func': {
      const name = sub(node, 'fName').trim();
      const known = /^(sin|cos|tan|cot|sec|csc|ln|log|exp|min|max|lim|det|arg|sup|inf|gcd|dim|ker|Pr|E|Var|Cov)$/.test(name);
      const head = known ? (/^(E|Var|Cov|Pr)$/.test(name) ? `\\operatorname{${name}}` : `\\${name}`) : name;
      return `${head} ${sub(node, 'e')}`;
    }
    case 'eqArr': return `\\begin{aligned} ${kids(node, 'e').map(ommlToLatex).join(' \\\\ ')} \\end{aligned}`;
    case 'm': {
      const rows = kids(node, 'mr').map((r) => kids(r, 'e').map(ommlToLatex).join(' & '));
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }
    case 'brk': return ' \\\\ ';
    case 'ctrlPr': case 'rPr': case 'sSubPr': case 'sSupPr': case 'sSubSupPr': case 'sPrePr': case 'fPr': case 'radPr': case 'naryPr':
    case 'dPr': case 'accPr': case 'barPr': case 'boxPr': case 'borderBoxPr': case 'groupChrPr': case 'limLowPr': case 'limUppPr':
    case 'funcPr': case 'eqArrPr': case 'mPr': case 'argPr': case 'phantPr':
      return '';
    default:
      // Unknown container: render what is inside it rather than lose it.
      return node.children.map(ommlToLatex).join('');
  }
}

function sub(node: XNode, name: string): string {
  const n = child(node, name);
  return n ? n.children.map(ommlToLatex).join('') : '';
}

/** The first equation under a shape's text body, or null when the shape has none. */
export function findOmml(sp: XNode): XNode | null {
  const stack: XNode[] = [sp];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.name === 'oMathPara' || n.name === 'oMath') return n;
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return null;
}

/** Excel's linear-format placeholders and grouping brackets, which read as noise in a cell. */
export function stripLinearPlaceholders(s: string): string {
  return s.replace(/[▒〖〗]/g, '');
}
