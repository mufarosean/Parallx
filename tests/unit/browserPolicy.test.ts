/**
 * The private browser's pure rules (electron/browserPolicy.cjs): what counts as
 * third-party, what gets an HTTPS upgrade, what the address bar does with typed
 * text, which permissions prompt, and how downloads are named.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const policy = require('../../electron/browserPolicy.cjs');

describe('isViewColor', () => {
  it('accepts hex and rgb colours for the page view background, nothing else', () => {
    expect(policy.isViewColor('#16171a')).toBe(true);
    expect(policy.isViewColor('#fff')).toBe(true);
    expect(policy.isViewColor('rgb(255, 255, 255)')).toBe(true);
    expect(policy.isViewColor('rgba(0, 0, 0, 0.5)')).toBe(true);
    expect(policy.isViewColor('rgb(22 23 26)')).toBe(false);
    expect(policy.isViewColor('url(x)')).toBe(false);
    expect(policy.isViewColor('#16171a; background: url(x)')).toBe(false);
    expect(policy.isViewColor('')).toBe(false);
    expect(policy.isViewColor(undefined)).toBe(false);
  });
});

describe('siteKey and isThirdParty', () => {
  it('reduces a host to its registrable domain', () => {
    expect(policy.siteKey('https://a.b.example.co.uk/x?y')).toBe('example.co.uk');
    expect(policy.siteKey('https://news.ycombinator.com/')).toBe('ycombinator.com');
    expect(policy.siteKey('http://localhost:3000/')).toBe('localhost');
    expect(policy.siteKey('not a url')).toBeNull();
  });
  it('treats another registrable domain as third-party, a subdomain as first-party', () => {
    expect(policy.isThirdParty('https://cdn.tracker.com/p.gif', 'https://www.example.com/')).toBe(true);
    expect(policy.isThirdParty('https://static.example.com/a.js', 'https://www.example.com/')).toBe(false);
    expect(policy.isThirdParty('https://www.example.com/', undefined)).toBe(false);
  });
});

describe('httpsUpgradeTarget', () => {
  it('upgrades public http URLs and nothing else', () => {
    expect(policy.httpsUpgradeTarget('http://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(policy.httpsUpgradeTarget('http://example.com:80/')).toBe('https://example.com/');
    expect(policy.httpsUpgradeTarget('https://example.com/')).toBeNull();
    expect(policy.httpsUpgradeTarget('http://localhost:3000/')).toBeNull();
    expect(policy.httpsUpgradeTarget('http://192.168.1.5/')).toBeNull();
    expect(policy.httpsUpgradeTarget('http://[::1]/')).toBeNull();
    expect(policy.httpsUpgradeTarget('http://router/')).toBeNull();
    expect(policy.httpsUpgradeTarget('http://printer.local/')).toBeNull();
    expect(policy.httpsUpgradeTarget('garbage')).toBeNull();
  });
});

describe('genericUserAgent', () => {
  it('is a plain Chrome UA with no Electron and no minor version', () => {
    const ua = policy.genericUserAgent('140.0.7339.41', 'win32');
    expect(ua).toContain('Chrome/140.0.0.0');
    expect(ua).toContain('Windows NT 10.0; Win64; x64');
    expect(ua).not.toMatch(/Electron|Parallx/i);
    expect(policy.genericUserAgent('140.0.1', 'darwin')).toContain('Macintosh');
  });
});

describe('parseOmnibox', () => {
  it('opens things that look like addresses and searches everything else', () => {
    expect(policy.parseOmnibox('example.com', 'duckduckgo')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(policy.parseOmnibox('https://x.org/p', 'duckduckgo').url).toBe('https://x.org/p');
    expect(policy.parseOmnibox('localhost:8080', 'duckduckgo').url).toBe('http://localhost:8080/');
    expect(policy.parseOmnibox('192.168.1.1', 'duckduckgo').url).toBe('http://192.168.1.1/');
    const s = policy.parseOmnibox('who fixes a kitchen leak', 'duckduckgo');
    expect(s.kind).toBe('search');
    expect(s.url).toBe('https://duckduckgo.com/?q=who%20fixes%20a%20kitchen%20leak');
    expect(policy.parseOmnibox('example.com is down', 'brave').url).toContain('search.brave.com');
    expect(policy.parseOmnibox('', 'duckduckgo').url).toBe('about:newtab');
    expect(policy.parseOmnibox('x', 'nonsense-engine').url).toContain('duckduckgo.com');
  });
});

describe('permissions and cookies', () => {
  it('prompts for the human ones, refuses device access, refuses the unknown', () => {
    expect(policy.permissionPolicy('media')).toBe('ask');
    expect(policy.permissionPolicy('geolocation')).toBe('ask');
    expect(policy.permissionPolicy('fullscreen')).toBe('allow');
    expect(policy.permissionPolicy('usb')).toBe('deny');
    expect(policy.permissionPolicy('display-capture')).toBe('deny');
    expect(policy.permissionPolicy('made-up')).toBe('deny');
  });
  it('strips third-party cookies by default, all when asked, none when allowed', () => {
    const site = policy.defaultSite();
    expect(policy.cookieDecision(site, 'https://ads.net/x', 'https://shop.com/')).toBe('strip');
    expect(policy.cookieDecision(site, 'https://api.shop.com/x', 'https://shop.com/')).toBe('allow');
    expect(policy.cookieDecision({ cookies: 'block-all' }, 'https://api.shop.com/x', 'https://shop.com/')).toBe('strip');
    expect(policy.cookieDecision({ cookies: 'allow' }, 'https://ads.net/x', 'https://shop.com/')).toBe('allow');
    expect(policy.normalizeSite({ cookies: 'bogus', shields: 'yes' })).toEqual(policy.defaultSite());
  });
});

describe('downloads', () => {
  it('names files safely and never overwrites', () => {
    expect(policy.sanitizeFilename('../../evil:name?.exe')).toBe('evil_name_.exe');
    expect(policy.sanitizeFilename('')).toBe('download');
    const taken = new Set(['D:\\W\\Downloads\\report.pdf', 'D:\\W\\Downloads\\report (2).pdf']);
    expect(policy.downloadTarget('D:\\W\\Downloads', 'report.pdf', (p: string) => taken.has(p))).toBe('D:\\W\\Downloads\\report (3).pdf');
    expect(policy.downloadTarget('/home/u/Downloads/', 'a.zip', () => false)).toBe('/home/u/Downloads/a.zip');
  });
});

describe('popups', () => {
  it('allows one window per fresh gesture and nothing without one', () => {
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: 200, popupsSinceGesture: 0, listed: false })).toBe('allow');
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: 200, popupsSinceGesture: 1, listed: false })).toBe('block');
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: policy.POPUP_GESTURE_MS + 1, popupsSinceGesture: 0, listed: false })).toBe('block');
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: Infinity, popupsSinceGesture: 0, listed: false })).toBe('block');
  });
  it('never opens a listed destination or a non-web scheme', () => {
    expect(policy.popupDecision({ url: 'https://ads.example/x', gestureAgeMs: 10, popupsSinceGesture: 0, listed: true })).toBe('block');
    expect(policy.popupDecision({ url: 'about:blank', gestureAgeMs: 10, popupsSinceGesture: 0, listed: false })).toBe('drop');
    expect(policy.popupDecision({ url: 'javascript:alert(1)', gestureAgeMs: 10, popupsSinceGesture: 0, listed: false })).toBe('drop');
    expect(policy.popupDecision({ url: undefined, gestureAgeMs: 10, popupsSinceGesture: 0, listed: false })).toBe('drop');
  });
});
