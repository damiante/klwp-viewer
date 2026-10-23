import type { Platform } from './klwp/resources';

export const browserPlatform: Platform = {
  async registerFont(bytes, family) {
    try {
      const face = new FontFace(family, bytes as BufferSource);
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  },
  async decodeImage(bytes, mime) {
    if (mime === 'image/svg+xml') {
      // shortcut: blob URLs are never revoked; presets hold few images.
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      await img.decode();
      return img;
    }
    return createImageBitmap(new Blob([bytes as BlobPart]));
  },
};
