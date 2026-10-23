import { type Zippable, unzipSync, zipSync } from 'fflate';

export interface PresetInfo {
  version: number;
  title: string;
  description?: string;
  width: number;
  height: number;
  xscreens: number;
  yscreens?: number;
  features?: string;
}

export type ModuleJson = Record<string, unknown> & { internal_type?: string };

export interface KlwpArchive {
  info: PresetInfo;
  root: ModuleJson;
  /** Archive members keyed by path, e.g. "fonts/x.ttf". */
  files: Map<string, Uint8Array>;
}

// Presets and their assets are small; anything bigger is not a real preset.
const MAX_UNCOMPRESSED = 200 * 1024 * 1024;

export function readKlwp(data: Uint8Array): KlwpArchive {
  let total = 0;
  const raw = unzipSync(data, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_UNCOMPRESSED) throw new Error('Archive too large');
      return !f.name.endsWith('/');
    },
  });
  const files = new Map<string, Uint8Array>(Object.entries(raw));
  const presetBytes = files.get('preset.json');
  if (!presetBytes) throw new Error('Not a KLWP preset: preset.json missing');
  const json = JSON.parse(new TextDecoder().decode(presetBytes)) as { preset_info?: PresetInfo; preset_root?: ModuleJson };
  if (!json.preset_root || !json.preset_info) throw new Error('Not a KLWP preset: missing preset_info/preset_root');
  return { info: json.preset_info, root: json.preset_root, files };
}

export const KFILE_PREFIX = 'kfile://org.kustom.provider/';
export const THUMB_PORTRAIT = 'preset_thumb_portrait.jpg';
export const THUMB_LANDSCAPE = 'preset_thumb_landscape.jpg';

/**
 * Writes a .klwp zip in the app's order (PresetExporter.a): preset.json, thumbnails,
 * then each resource at the path its kfile:// URI names.
 */
export function writeKlwp(info: PresetInfo, root: ModuleJson, files: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {};
  entries['preset.json'] = new TextEncoder().encode(JSON.stringify({ preset_info: info, preset_root: root }, null, 2));
  for (const name of [THUMB_PORTRAIT, THUMB_LANDSCAPE]) {
    const bytes = files.get(name);
    if (bytes) entries[name] = [bytes, { level: 0 }];
  }
  for (const [path, bytes] of files) {
    if (path === 'preset.json' || path === THUMB_PORTRAIT || path === THUMB_LANDSCAPE) continue;
    entries[path] = bytes;
  }
  return zipSync(entries, { level: 6 });
}

/** Maps a kfile:// URI to its archive path ("kfile://org.kustom.provider/bitmaps/X" -> "bitmaps/X"). */
export function kfilePath(uri: string): string | null {
  const m = /^kfile:\/\/[^/]+\/(.+)$/.exec(uri.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
