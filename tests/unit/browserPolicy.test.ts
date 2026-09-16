/**
 * The private browser's pure rules (electron/browserPolicy.cjs): what counts as
 * third-party, what gets an HTTPS upgrade, what the address bar does with typed
 * text, which permissions prompt (and what the assistant's profile never gets),
 * which addresses the assistant's pages may not reach, and how downloads are
 * named.
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

describe('inAppLinkDecision', () => {
  it('sends plain http(s) links to the browser extension only while it has claimed them', () => {
    expect(policy.inAppLinkDecision('https://example.com/a?b=1', true, false)).toBe(true);
    expect(policy.inAppLinkDecision('http://example.com', true, false)).toBe(true);
    expect(policy.inAppLinkDecision('https://example.com', false, false)).toBe(false);   // extension disabled or setting off
    expect(policy.inAppLinkDecision('https://example.com', true, true)).toBe(false);     // Open In System Browser
    expect(policy.inAppLinkDecision('mailto:a@b.c', true, false)).toBe(false);
    expect(policy.inAppLinkDecision('file:///C:/x', true, false)).toBe(false);
    expect(policy.inAppLinkDecision('https://exa mple.com', true, false)).toBe(false);
    expect(policy.inAppLinkDecision(undefined, true, false)).toBe(false);
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

describe('user agent', () => {
  it('is no longer the policy\'s to rewrite: the session sends Electron\'s own', () => {
    // The plain-Chrome rewrite hid nothing and broke every Cloudflare
    // challenge (a Chrome UA with no client hints reads as a spoof). The
    // bridge sets app.userAgentFallback; nothing here may hand it another.
    expect(policy.genericUserAgent).toBeUndefined();
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
  it('gives the assistant profile nothing that reaches past its pane, while the user keeps fullscreen and clipboard writes', () => {
    expect(policy.agentPermission('fullscreen')).toBe(false);
    expect(policy.agentPermission('clipboard-sanitized-write')).toBe(false);
    expect(policy.agentPermission('media')).toBe(false);        // 'ask' for the user; the assistant asks nobody
    expect(policy.agentPermission('geolocation')).toBe(false);
    expect(policy.agentPermission('usb')).toBe(false);
    expect(policy.agentPermission('made-up')).toBe(false);
    expect(policy.permissionPolicy('fullscreen')).toBe('allow');
    expect(policy.permissionPolicy('clipboard-sanitized-write')).toBe('allow');
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

describe('private addresses', () => {
  it('knows loopback, private, link-local and reserved literals and the local-use names', () => {
    for (const h of ['127.0.0.1', '127.8.9.10', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255',
      '::1', '[::1]', '::', 'fe80::1', 'fd12:3456::1', '[::ffff:127.0.0.1]', '::ffff:7f00:1', '64:ff9b::10.0.0.1',
      'localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'printer.local', 'router.home.arpa', 'build.internal']) {
      expect(policy.isPrivateHostLiteral(h), h).toBe(true);
    }
  });
  it('reads IPv4 the way Chromium does, so a number in another spelling is still loopback', () => {
    expect(policy.isPrivateHostLiteral('2130706433')).toBe(true);
    expect(policy.isPrivateHostLiteral('0x7f.1')).toBe(true);
  });
  it('leaves public addresses and ordinary names alone', () => {
    for (const h of ['8.8.8.8', '172.32.0.1', '172.15.255.255', '192.169.0.1', 'example.com', 'localhost.example.com', 'mylocalhost',
      '2606:4700::1111', '[::ffff:8.8.8.8]', '1.2.3.4.5', '']) {
      expect(policy.isPrivateHostLiteral(h), h).toBe(false);
    }
    expect(policy.isPrivateHostLiteral(undefined)).toBe(false);
  });
  it('refuses private URLs unless the host is on the allow list, whatever its spelling', () => {
    const none = policy.parseHostList(undefined);
    expect(none.size).toBe(0);
    const allowed = policy.parseHostList(' 127.0.0.1 ,,LOCALHOST,[::1] ');
    expect([...allowed].sort()).toEqual(['127.0.0.1', '::1', 'localhost']);
    expect(policy.privateAddressRefused('http://127.0.0.1:8080/x', none)).toBe(true);
    expect(policy.privateAddressRefused('http://127.0.0.1:8080/x', allowed)).toBe(false);
    expect(policy.privateAddressRefused('http://2130706433/', allowed)).toBe(false);
    expect(policy.privateAddressRefused('http://2130706433/', none)).toBe(true);
    expect(policy.privateAddressRefused('http://[::1]:9/', allowed)).toBe(false);
    expect(policy.privateAddressRefused('http://192.168.1.1/admin', allowed)).toBe(true);
    expect(policy.privateAddressRefused('http://localhost:3000/', policy.parseHostList('127.0.0.1'))).toBe(true);
    expect(policy.privateAddressRefused('ws://localhost:1/', none)).toBe(true);
    expect(policy.privateAddressRefused('https://example.com/', none)).toBe(false);
    expect(policy.privateAddressRefused('data:text/html,x', none)).toBe(false);
    expect(policy.privateAddressRefused('garbage', none)).toBe(false);
  });
});

describe('popups', () => {
  it('allows one window per fresh gesture and nothing without one', () => {
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: 200, popupsSinceGesture: 0, listed: false })).toBe('allow');
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: 200, popupsSinceGesture: 1, listed: false })).toBe('block');
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: policy.POPUP_GESTURE_MS + 1, popupsSinceGesture: 0, listed: false })).toBe('block');
    expect(policy.popupDecision({ url: 'https://a.com/', gestureAgeMs: Infinity, popupsSinceGesture: 0, listed: false })).toBe('block');
  });
  it('counts a press, not its release, and no key that is only Escape or a modifier', () => {
    // Chromium grants activation on mousedown and keydown. mouseup and the
    // char event that follows a keydown are the same act; counting them let a
    // page open two windows on one click.
    expect(policy.activationInput({ type: 'mouseDown', button: 'left' })).toBe(true);
    expect(policy.activationInput({ type: 'mouseDown', button: 'middle' })).toBe(true);
    expect(policy.activationInput({ type: 'mouseDown', button: 'right' })).toBe(false);
    expect(policy.activationInput({ type: 'mouseUp', button: 'left' })).toBe(false);
    expect(policy.activationInput({ type: 'keyDown', key: 'a' })).toBe(true);
    expect(policy.activationInput({ type: 'rawKeyDown', key: 'Enter' })).toBe(true);
    expect(policy.activationInput({ type: 'keyDown', key: 'Escape' })).toBe(false);
    expect(policy.activationInput({ type: 'keyDown', key: 'Shift' })).toBe(false);
    expect(policy.activationInput({ type: 'char', key: 'a' })).toBe(false);
    expect(policy.activationInput({ type: 'keyUp', key: 'a' })).toBe(false);
    expect(policy.activationInput({ type: 'mouseWheel' })).toBe(false);
    expect(policy.activationInput({ type: 'mouseMove' })).toBe(false);
    expect(policy.activationInput(undefined)).toBe(false);
  });
  it('never opens a listed destination or a non-web scheme', () => {
    expect(policy.popupDecision({ url: 'https://ads.example/x', gestureAgeMs: 10, popupsSinceGesture: 0, listed: true })).toBe('block');
    expect(policy.popupDecision({ url: 'about:blank', gestureAgeMs: 10, popupsSinceGesture: 0, listed: false })).toBe('drop');
    expect(policy.popupDecision({ url: 'javascript:alert(1)', gestureAgeMs: 10, popupsSinceGesture: 0, listed: false })).toBe('drop');
    expect(policy.popupDecision({ url: undefined, gestureAgeMs: 10, popupsSinceGesture: 0, listed: false })).toBe('drop');
  });
});
describe('redirects', () => {
  const site = policy.defaultSite();
  const from = 'https://news.example/story';
  it('never questions a navigation that stays on the site, or one that is not web content', () => {
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://cdn.news.example/next', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: 60_000, site })).toBe('allow');
    expect(policy.navigationDecision({ fromUrl: 'about:blank', toUrl: 'https://other.example/', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: 60_000, site })).toBe('allow');
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'mailto:a@b.c', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: 60_000, site })).toBe('allow');
  });
  it('lets a click leave the site, and blocks the tab-under that rides the same click', () => {
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://other.example/', activationAgeMs: 120, popupsSinceActivation: 0, documentAgeMs: 60_000, site })).toBe('allow');
    // The page opened a window on this click (allowed, one per activation),
    // then set location: the popunder's other half.
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://ads.example/land', activationAgeMs: 120, popupsSinceActivation: 1, documentAgeMs: 60_000, site })).toBe('tab-under');
  });
  it('lets a fresh document redirect on its own, and holds a settled one that does', () => {
    // A sign-in hop, a link shortener, a consent page: they redirect at once.
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://sso.example/login', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: 400, site })).toBe('allow');
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://sso.example/login', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: policy.REDIRECT_GRACE_MS - 1, site })).toBe('allow');
    // A page the user has been reading, sending them elsewhere with no act of theirs.
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://ads.example/land', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: policy.REDIRECT_GRACE_MS, site })).toBe('hold');
    // An old activation is no activation: a click five minutes ago does not cover this.
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://ads.example/land', activationAgeMs: policy.ACTIVATION_MS + 1, popupsSinceActivation: 0, documentAgeMs: 60_000, site })).toBe('hold');
    // Unknown document age reads as fresh: the doubt goes to the page.
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://ads.example/land', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: undefined, site })).toBe('allow');
  });
  it('a site the user marked may redirect freely; the default may not', () => {
    expect(policy.navigationDecision({ fromUrl: from, toUrl: 'https://other.example/', activationAgeMs: Infinity, popupsSinceActivation: 0, documentAgeMs: 60_000, site: { ...site, redirects: true } })).toBe('allow');
    expect(policy.defaultSite().redirects).toBe(false);
    expect(policy.normalizeSite({ redirects: true }).redirects).toBe(true);
    expect(policy.normalizeSite({ redirects: 'yes' }).redirects).toBe(false);
  });
});
