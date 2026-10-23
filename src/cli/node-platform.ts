import { DOMMatrix, GlobalFonts, Image, Path2D } from '@napi-rs/canvas';
import type { Platform } from '../klwp/resources';

// The renderer uses these browser globals.
const g = globalThis as Record<string, unknown>;
g.Path2D ??= Path2D;
g.DOMMatrix ??= DOMMatrix;

export const nodePlatform: Platform = {
  async registerFont(bytes, family) {
    return GlobalFonts.register(Buffer.from(bytes), family) !== null;
  },
  async decodeImage(bytes) {
    const img = new Image();
    // `complete` is true synchronously but raster pixels are only ready at onload;
    // drawing earlier throws "Image is not completed".
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = Buffer.from(bytes);
    });
    return img.width > 0 && img.height > 0 ? (img as unknown as CanvasImageSource) : null;
  },
};
