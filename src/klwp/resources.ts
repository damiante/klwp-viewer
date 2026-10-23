import { kfilePath } from './archive';

export interface ImageRes {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface IconSet {
  family: string;
  codes: Map<string, number>;
}

/** Font registration and image decoding differ between the browser and Node (CLI). */
export interface Platform {
  registerFont(bytes: Uint8Array, family: string): Promise<boolean>;
  decodeImage(bytes: Uint8Array, mime: 'image/svg+xml' | 'raster'): Promise<CanvasImageSource | null>;
}

/** Fallback for the app's bundled default font (assets/fonts/Roboto-Regular.ttf). */
export const DEFAULT_FONT = 'Roboto, "Helvetica Neue", Arial, sans-serif';

let familySeq = 0;

export function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  return /<svg[\s>]/i.test(head);
}

/**
 * Ensures an SVG has explicit width/height (browsers report no intrinsic size otherwise)
 * and returns that size; KLWP sizes vectors by their aspect ratio.
 */
export function normalizeSvg(text: string): { text: string; width: number; height: number } | null {
  const m = /<svg\b([^>]*)>/i.exec(text);
  if (!m) return null;
  const attrs = m[1];
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1] ?? null;
  const vb = (attr('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every((n) => isFinite(n)) && vb[2] > 0 && vb[3] > 0;
  const len = (v: string | null, ref: number | undefined): number | undefined => {
    if (!v) return undefined;
    if (v.trim().endsWith('%')) return ref;
    const n = parseFloat(v);
    // Unit suffixes (mm, pt...) only matter for the aspect ratio, which they preserve.
    return isFinite(n) && n > 0 ? n : undefined;
  };
  let w = len(attr('width'), hasVb ? vb[2] : undefined);
  let h = len(attr('height'), hasVb ? vb[3] : undefined);
  if (hasVb) {
    w ??= h !== undefined ? (h * vb[2]) / vb[3] : vb[2];
    h ??= (w * vb[3]) / vb[2];
  }
  if (!w || !h) return null;
  let rest = attrs.replace(/\s(width|height|preserveAspectRatio)\s*=\s*["'][^"']*["']/gi, '');
  if (!hasVb) rest += ` viewBox="0 0 ${w} ${h}"`;
  const tag = `<svg${rest} width="${w}" height="${h}" preserveAspectRatio="none">`;
  return { text: text.slice(0, m.index) + tag + text.slice(m.index + m[0].length), width: w, height: h };
}

/** Loads fonts, images and icon sets referenced by kfile:// URIs. */
export class Resources {
  private fonts = new Map<string, string>();
  private images = new Map<string, ImageRes | null>();
  private iconSets = new Map<string, IconSet>();
  readonly missing = new Set<string>();

  constructor(private platform: Platform) {}

  static async load(files: Map<string, Uint8Array>, platform: Platform): Promise<Resources> {
    const res = new Resources(platform);
    await Promise.all([...files].map(([path, bytes]) => res.addFile(path, bytes, files)));
    return res;
  }

  /** Registers one archive member; `files` is used to find an icon set's .json sibling. */
  async addFile(path: string, bytes: Uint8Array, files: Map<string, Uint8Array>): Promise<void> {
    this.missing.delete(path);
    if (path.startsWith('fonts/')) await this.addFont(path, bytes);
    else if (path.startsWith('bitmaps/')) this.images.set(path, await this.loadImage(bytes));
    else if (path.startsWith('icons/') && /\.(ttf|otf)$/i.test(path)) await this.addIconSet(path, bytes, files.get(path.replace(/\.\w+$/, '.json')));
    else if (path.startsWith('icons/') && path.endsWith('.json')) {
      const ttf = [...files.keys()].find((k) => k.replace(/\.\w+$/, '.json') === path && k !== path);
      if (ttf) await this.addIconSet(ttf, files.get(ttf)!, bytes);
    }
  }

  private async loadImage(bytes: Uint8Array): Promise<ImageRes | null> {
    try {
      if (isSvg(bytes)) {
        const norm = normalizeSvg(new TextDecoder().decode(bytes));
        if (!norm) return null;
        const image = await this.platform.decodeImage(new TextEncoder().encode(norm.text), 'image/svg+xml');
        return image ? { image, width: norm.width, height: norm.height } : null;
      }
      const image = await this.platform.decodeImage(bytes, 'raster');
      if (!image) return null;
      const { width, height } = image as { width: number; height: number };
      return { image, width, height };
    } catch {
      return null;
    }
  }

  private async addFont(path: string, bytes: Uint8Array): Promise<string | null> {
    const family = `klwp-font-${++familySeq}`;
    const ok = await this.platform.registerFont(bytes, family).catch(() => false);
    if (!ok) return null;
    this.fonts.set(path, family);
    return family;
  }

  private async addIconSet(path: string, bytes: Uint8Array, json: Uint8Array | undefined): Promise<void> {
    const codes = json ? parseIconNames(json) : new Map<string, number>();
    const family = this.fonts.get(path) ?? (await this.addFont(path, bytes));
    if (family) this.iconSets.set(path, { family, codes });
  }

  font(uri: string): string {
    const path = kfilePath(uri);
    const family = path ? this.fonts.get(path) : undefined;
    if (family) return `"${family}"`;
    if (uri) this.missing.add(path ?? uri);
    return DEFAULT_FONT;
  }

  image(uri: string): ImageRes | null {
    if (!uri) return null;
    const path = kfilePath(uri);
    const img = path ? this.images.get(path) : undefined;
    if (!img) this.missing.add(path ?? uri);
    return img ?? null;
  }

  iconSet(uri: string): IconSet | null {
    const path = kfilePath(uri);
    const set = path ? this.iconSets.get(path) : undefined;
    if (!set) this.missing.add(path ?? (uri || 'default icon set (icons/material.ttf)'));
    return set ?? null;
  }
}

/** Reads an IcoMoon selection.json: icon name -> code point. */
export function parseIconNames(json: Uint8Array): Map<string, number> {
  const codes = new Map<string, number>();
  try {
    const data = JSON.parse(new TextDecoder().decode(json)) as {
      icons?: { properties?: { name?: string; code?: number } }[];
    };
    for (const icon of data.icons ?? []) {
      const p = icon.properties;
      if (p?.name && typeof p.code === 'number') codes.set(p.name.toLowerCase(), p.code);
    }
  } catch {
    // Malformed JSON: no names.
  }
  return codes;
}
