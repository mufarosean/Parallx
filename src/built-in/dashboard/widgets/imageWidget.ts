// imageWidget.ts — user-uploaded image / GIF widget.
//
// The user drops, picks, or links an image. Uploads are written to disk by the
// asset bridge (electron/dashboardAssetBridge.cjs) and referenced by id — the
// widget's cache holds only a tiny `asset:<id>` string, so a GIF of ANY size
// renders with its animation intact (no 256 KB inline-cache flattening). A
// remote Image URL renders directly. Legacy widgets that stored a `data:` URL
// still work. Fallback (no bridge / tests): inline data URL, capped.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

type ImageFit = 'cover' | 'contain';

interface ImageWidgetConfig {
  readonly fit: ImageFit;
  readonly rounded: boolean;
  readonly url: string;
}

const DEFAULT_CONFIG: ImageWidgetConfig = { fit: 'cover', rounded: true, url: '' };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

// Keep the encoded data URL comfortably under MAX_CACHED_OUTPUT_BYTES (256 KB)
// so the cache layer never truncates it (which would corrupt the image).
const MAX_DATA_URL_CHARS = 240_000;
const MAX_EDGE_PX = 1280;

// ── File-backed asset store (parallx-asset://) ───────────────────────────────
// Uploads are written to disk and referenced by id, so a GIF of ANY size loads
// with its animation intact — the 256 KB inline text cache never holds it.
interface DashboardAssetBridge {
  save(bytes: ArrayBuffer, mime: string): Promise<{ id?: string; error?: string }>;
  delete(id: string): Promise<{ ok: boolean }>;
}
function assetBridge(): DashboardAssetBridge | undefined {
  return (globalThis as { parallxElectron?: { dashboardAssets?: DashboardAssetBridge } })
    .parallxElectron?.dashboardAssets;
}
const ASSET_REF = 'asset:';
function assetSrc(id: string): string { return `parallx-asset://asset/${id}`; }

function normalizeConfig(raw: unknown): ImageWidgetConfig {
  const cfg = (raw ?? {}) as Partial<ImageWidgetConfig>;
  return {
    fit: cfg.fit === 'contain' ? 'contain' : 'cover',
    rounded: cfg.rounded !== false,
    url: typeof cfg.url === 'string' ? cfg.url : '',
  };
}

/**
 * Downscale the chosen file with a canvas and encode to a data URL, dropping
 * JPEG quality until the result fits the cache budget. Returns null if the
 * image can't be loaded.
 */
async function fileToBoundedDataUrl(file: File): Promise<string | null> {
  const bitmap = await loadImage(file);
  if (!bitmap) return null;

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d');
  if (!cx) return null;
  cx.drawImage(bitmap, 0, 0, w, h);

  // PNG first to preserve transparency for small/simple images; if it's too
  // big, fall back to progressively-lower-quality JPEG.
  let url = canvas.toDataURL('image/png');
  if (url.length <= MAX_DATA_URL_CHARS) return url;

  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_DATA_URL_CHARS) return url;
  }
  return url.length <= MAX_DATA_URL_CHARS ? url : null;
}

/** Read a file to a data URL verbatim — preserves GIF/WebP/APNG animation
 *  (never canvas-flattened). */
function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = String(reader.result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export const IMAGE_WIDGET: WidgetTypeRegistration<ImageWidgetConfig> = {
  typeId: 'parallx.dashboard.image',
  displayName: 'Image',
  description: 'Pin a picture to your dashboard. Drag-and-drop or click to upload.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 3 },
  chromeStyle: 'bare',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      fit: {
        type: 'enum',
        label: 'Image fit',
        description: 'How the picture fills the widget.',
        options: [
          { value: 'cover', label: 'Cover (fill, may crop)' },
          { value: 'contain', label: 'Contain (fit, no crop)' },
        ],
      },
      rounded: {
        type: 'boolean',
        label: 'Rounded corners',
      },
      url: {
        type: 'string',
        label: 'Image URL (optional)',
        description: 'Point at a remote image or GIF — animated GIFs play at full size, no upload needed. Leave blank to use an uploaded image.',
        placeholder: 'https://…/animation.gif',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<ImageWidgetConfig>): WidgetHandle {
    container.classList.add('iw');
    let config = normalizeConfig(ctx.config);
    let stored: string | null = ctx.cachedOutput;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    const img = document.createElement('img');
    img.className = 'iw__img';
    img.alt = '';

    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'iw__empty';
    empty.innerHTML = `${ICON_SVG}<span class="iw__empty-text">Drop an image here<br><small>or click to upload</small></span>`;

    const replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'iw__replace';
    replace.title = 'Replace image';
    replace.textContent = 'Replace';

    container.appendChild(img);
    container.appendChild(empty);
    container.appendChild(replace);

    // A bad/blocked URL, network failure, or corrupt data leaves an <img>
    // blank — never let the widget silently show nothing.
    img.addEventListener('error', () => {
      img.style.display = 'none';
      empty.style.display = '';
      replace.style.display = 'none';
    });

    function applyConfig(): void {
      img.style.objectFit = config.fit;
      container.classList.toggle('iw--rounded', config.rounded);
    }

    // `stored` is the cache reference: 'asset:<id>' (file-backed), a legacy
    // 'data:…' URL, or null.
    function render(): void {
      const url = config.url.trim();
      let src = '';
      if (/^https?:\/\//i.test(url)) {
        src = url; // a remote URL wins when set
      } else if (typeof stored === 'string') {
        if (stored.startsWith(ASSET_REF)) src = assetSrc(stored.slice(ASSET_REF.length));
        else if (stored.startsWith('data:')) src = stored;
      }
      const has = !!src;
      if (has) img.src = src;
      img.style.display = has ? '' : 'none';
      const urlDriven = /^https?:\/\//i.test(url);
      empty.style.display = has ? 'none' : '';
      // The upload affordances only matter when a URL isn't driving it.
      replace.style.display = has && !urlDriven ? '' : 'none';
    }

    async function ingest(file: File | undefined | null): Promise<void> {
      if (!file || !file.type.startsWith('image/')) return;
      container.classList.add('iw--loading');
      const prev = stored;
      const bridge = assetBridge();
      try {
        let next: string | null = null;
        if (bridge) {
          // File-backed: store the ORIGINAL bytes (any size, animation intact)
          // and reference them by id — the 256 KB text cache never sees them.
          const res = await bridge.save(await file.arrayBuffer(), file.type);
          if (res?.id) next = `${ASSET_REF}${res.id}`;
          else console.warn('[ImageWidget] Asset save failed:', res?.error);
        }
        if (!next) {
          // No bridge (tests/browser): inline. Animated formats keep animation
          // if they fit the cache; otherwise a downscaled still.
          const animated = file.type === 'image/gif' || file.type === 'image/webp' || file.type === 'image/apng';
          const raw = animated ? await fileToDataUrl(file) : null;
          next = raw && raw.length <= MAX_DATA_URL_CHARS ? raw : await fileToBoundedDataUrl(file);
        }
        if (!next) return;
        stored = next;
        ctx.setCachedOutput(next);
        render();
        // Free the previous file-backed asset, best-effort.
        if (prev && prev.startsWith(ASSET_REF)) void bridge?.delete(prev.slice(ASSET_REF.length));
      } finally {
        container.classList.remove('iw--loading');
      }
    }

    const pick = () => fileInput.click();
    empty.addEventListener('click', pick);
    replace.addEventListener('click', pick);
    fileInput.addEventListener('change', () => {
      void ingest(fileInput.files?.[0]);
      fileInput.value = '';
    });

    const onDragOver = (e: DragEvent) => { e.preventDefault(); container.classList.add('iw--drag'); };
    const onDragLeave = () => container.classList.remove('iw--drag');
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      container.classList.remove('iw--drag');
      void ingest(e.dataTransfer?.files?.[0]);
    };
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);

    const configSub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      applyConfig();
      render(); // pick up a URL change (or its removal)
    });

    applyConfig();
    render();

    return {
      refreshFromCache(cached) {
        stored = cached;
        render();
      },
      dispose() {
        container.removeEventListener('dragover', onDragOver);
        container.removeEventListener('dragleave', onDragLeave);
        container.removeEventListener('drop', onDrop);
        configSub.dispose();
      },
    };
  },
};
