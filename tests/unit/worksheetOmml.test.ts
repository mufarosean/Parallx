// OMML → LaTeX for the constructs measured across the Rising Fellow workbooks
// (sub/superscripts, n-ary with hidden limits, delimiters, fractions, radicals,
// accents, functions, equation arrays, matrices, pre-scripts, plain runs) and
// the math-italic letters Word writes into runs. The first case is a verbatim
// equation from Practice Exam 1.
import { describe, it, expect } from 'vitest';
import { parseXml } from '../../src/built-in/worksheet/ooxml';
import { ommlToLatex, findOmml, stripLinearPlaceholders } from '../../src/built-in/worksheet/omml';

const M = 'xmlns:m="m"';
const latex = (inner: string) => ommlToLatex(parseXml(`<m:oMath ${M}>${inner}</m:oMath>`));
const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;

describe('ommlToLatex', () => {
  it('renders the Practice Exam 1 ultimate-times-sum equation', () => {
    const s = latex(
      `<m:sSub><m:sSubPr/><m:e>${r('𝑈𝑙𝑡')}</m:e><m:sub>${r('𝑖')}</m:sub></m:sSub>${r('×')}` +
      `<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/><m:subHide m:val="on"/></m:naryPr><m:sub/>` +
      `<m:sup>${r('𝐴𝑌𝑠')}${r(' ')}${r('𝑎𝑓𝑡𝑒𝑟')}</m:sup>` +
      `<m:e><m:sSub><m:sSubPr/><m:e>${r('𝑈𝑙𝑡')}</m:e><m:sub>${r('𝐴𝑌')}</m:sub></m:sSub></m:e></m:nary>`,
    );
    expect(s).toBe('{Ult}_{i}\\times \\sum\\limits^{AYs\\ after} {Ult}_{AY}');
  });

  it('fractions, radicals with and without a degree, and delimiters', () => {
    expect(latex(`<m:f><m:fPr/><m:num>${r('1')}</m:num><m:den>${r('n')}</m:den></m:f>`)).toBe('\\frac{1}{n}');
    expect(latex(`<m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num>${r('a')}</m:num><m:den>${r('b')}</m:den></m:f>`)).toBe('{a}/{b}');
    expect(latex(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('x')}</m:e></m:rad>`)).toBe('\\sqrt{x}');
    expect(latex(`<m:rad><m:radPr/><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad>`)).toBe('\\sqrt[3]{x}');
    expect(latex(`<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${r('x')}</m:e></m:d>`)).toBe('\\left[ x \\right]');
    expect(latex(`<m:d><m:dPr/><m:e>${r('x')}</m:e></m:d>`)).toBe('\\left( x \\right)');
    expect(latex(`<m:d><m:dPr><m:begChr m:val=""/><m:endChr m:val="|"/></m:dPr><m:e>${r('x')}</m:e></m:d>`)).toBe('\\left. x \\right|');
  });

  it('sub, sup, both, pre-scripts, accents and bars', () => {
    expect(latex(`<m:sSup><m:sSupPr/><m:e>${r('e')}</m:e><m:sup>${r('−')}${r('x')}</m:sup></m:sSup>`)).toBe('{e}^{-x}');
    expect(latex(`<m:sSubSup><m:sSubSupPr/><m:e>${r('C')}</m:e><m:sub>${r('k')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup>`)).toBe('{C}_{k}^{2}');
    expect(latex(`<m:sPre><m:sPrePr/><m:sub>${r('n')}</m:sub><m:sup>${r('m')}</m:sup><m:e>${r('X')}</m:e></m:sPre>`)).toBe('{}_{n}^{m}{X}');
    expect(latex(`<m:acc><m:accPr><m:chr m:val="̂"/></m:accPr><m:e>${r('ϕ')}</m:e></m:acc>`)).toBe('\\hat{\\phi }');
    expect(latex(`<m:acc><m:accPr><m:chr m:val="̄"/></m:accPr><m:e>${r('x')}</m:e></m:acc>`)).toBe('\\bar{x}');
    expect(latex(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r('x')}</m:e></m:bar>`)).toBe('\\overline{x}');
  });

  it('n-ary with both limits, functions, plain-text runs and symbols', () => {
    expect(latex(`<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('n')}</m:sup><m:e>${r('x')}</m:e></m:nary>`))
      .toBe('\\sum\\limits_{i=1}^{n} x');
    expect(latex(`<m:nary><m:naryPr><m:chr m:val="∫"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub>${r('0')}</m:sub><m:sup>${r('∞')}</m:sup><m:e>${r('f')}</m:e></m:nary>`))
      .toBe('\\int_{0}^{\\infty } f');
    expect(latex(`<m:func><m:funcPr/><m:fName>${r('ln')}</m:fName><m:e>${r('x')}</m:e></m:func>`)).toBe('\\ln x');
    expect(latex(`<m:func><m:funcPr/><m:fName>${r('Var')}</m:fName><m:e><m:d><m:dPr/><m:e>${r('U')}</m:e></m:d></m:e></m:func>`)).toBe('\\operatorname{Var} \\left( U \\right)');
    expect(latex(`<m:r><m:rPr><m:nor/></m:rPr><m:t>Earned Premium</m:t></m:r>`)).toBe('\\text{Earned Premium}');
    expect(latex(`<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>ELR</m:t></m:r>`)).toBe('\\text{ELR}');
    expect(latex(r('α≤β'))).toBe('\\alpha \\le \\beta ');
  });

  it('equation arrays, matrices and line breaks', () => {
    expect(latex(`<m:eqArr><m:eqArrPr/><m:e>${r('a=1')}</m:e><m:e>${r('b=2')}</m:e></m:eqArr>`)).toBe('\\begin{aligned} a=1 \\\\ b=2 \\end{aligned}');
    expect(latex(`<m:m><m:mPr/><m:mr><m:e>${r('1')}</m:e><m:e>${r('0')}</m:e></m:mr><m:mr><m:e>${r('0')}</m:e><m:e>${r('1')}</m:e></m:mr></m:m>`))
      .toBe('\\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix}');
    expect(latex(`${r('a')}<m:r><m:brk/><m:t>b</m:t></m:r>`)).toBe('a \\\\ b');
  });

  it('finds the equation under a shape and strips linear placeholders from fallback text', () => {
    const sp = parseXml(`<sp><txBody><p><m ${M}><m:oMathPara><m:oMath>${r('x')}</m:oMath></m:oMathPara></m></p></txBody></sp>`);
    expect(findOmml(sp)?.name).toBe('oMathPara');
    expect(ommlToLatex(findOmml(sp)!)).toBe('x');
    expect(findOmml(parseXml('<sp><txBody><p><r><t>plain</t></r></p></txBody></sp>'))).toBeNull();
    expect(stripLinearPlaceholders('〖Ult〗_i×∑1^(n)▒〖Ult〗_AY')).toBe('Ult_i×∑1^(n)Ult_AY');
  });
});
