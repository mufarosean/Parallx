// fitWide.js — a card's tables and formulas fit the card, never scrolling.

/**
 * Tables and display formulas never scroll and never split a word (the
 * owner, Oct 24: "Tables should not be scollabele, if a table takes up a lot
 * of room, let it"). The CSS gives a table the full width and keeps words
 * whole; one still wider than its box is scaled down to fit (not below 30%),
 * after it is drawn and whenever the box changes size.
 */
export function fcFitWide(host) {
  const fit = () => {
    if (!host.isConnected) { ro?.disconnect(); return; }
    for (const wide of host.querySelectorAll('table, .katex-display')) {
      wide.style.zoom = '';
      const room = wide.parentElement?.clientWidth ?? 0;
      if (room <= 0 || wide.scrollWidth <= room + 1) continue;
      // Scaled, a table lays its columns out again, so measure and settle twice more.
      let zoom = room / wide.scrollWidth;
      for (let i = 0; i < 3 && zoom > 0.3; i++) {
        wide.style.zoom = String(Math.max(0.3, zoom));
        const shown = wide.getBoundingClientRect().width;
        if (shown <= room + 0.5) break;
        zoom *= room / shown;
      }
    }
  };
  const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => fit());
  ro?.observe(host);
  requestAnimationFrame(fit);
  return host;
}
