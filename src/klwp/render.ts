// Canvas renderer reproducing KLWP's Android view hierarchy:
//  - RootLayerModule: screen-sized frame; children placed by anchor + offset.
//  - OverlapLayerModule: wrap-content frame; children placed by anchor, no offset.
//  - StackLayerModule: LinearLayout; children stacked with config_margin between them.
//  - Text/Shape/FontIcon/Bitmap: paint views measured as rotated object + padding.
// Units: 1 unit = min(screenW, screenH) / 720 px (config.u1.C), multiplied by every
// ancestor layer's config_scale_value / 100 (LayerModule.b()).

import type { ModuleJson, PresetInfo } from './archive';
import { ENUMS, isLayerType, moduleDefault } from './schema';
import { type FormulaContext, type Value, evaluateText, evaluateValue, isNumeric, valueToString } from './formula';
import { type DeviceState, createFunctions } from './functions';
import { DEFAULT_FONT, type Resources } from './resources';

/** Device-pixel bounding box of a drawn module (axis-aligned, after transforms). */
export interface ModuleBox {
  json: ModuleJson;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewState {
  /** Launcher scroll position, 0 = first screen, 1 = last screen. */
  offset: number;
  /** Number of launcher home screens. */
  screens: number;
}

interface Box {
  w: number;
  h: number;
  pad: [number, number, number, number]; // left, top, right, bottom
}

const ANCHORS: readonly string[] = ENUMS.anchor;
const STACKING: readonly string[] = ENUMS.stacking;
const FONT_SIZE: readonly string[] = ENUMS.fontSize;
const ALIGN: readonly string[] = ENUMS.textAlign;
const ROTATE: readonly string[] = ENUMS.rotate;
const GRADIENT: readonly string[] = ENUMS.gradient;
const SHAPES: readonly string[] = ENUMS.shape;
const VISIBLE: readonly string[] = ENUMS.visible;
const BITMAP_SCALE: readonly string[] = ENUMS.bitmapScale;

/** Parses KLWP colours (#AARRGGBB, #RRGGBB, #ARGB, #RGB) to CSS. */
export function parseColor(v: string, fallback = '#FFFFFFFF'): string {
  let s = (v || '').trim();
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) s = fallback;
  let hex = s.slice(1);
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length === 6) hex = 'FF' + hex;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(2)}, ${n(4)}, ${n(6)}, ${+(n(0) / 255).toFixed(4)})`;
}

class Env {
  readonly functions;
  readonly warnings = new Set<string>();
  pxPerUnit = 1;
  screenW = 0;
  screenH = 0;
  view: ViewState = { offset: 0.5, screens: 3 };
  onBox?: (box: ModuleBox) => void;
  private globalDepth = new Map<string, number>();
  readonly fctx: FormulaContext;
  private globals: Record<string, { type?: string; value?: unknown; global_formula?: string; toggles?: number }>;

  constructor(root: ModuleJson, public resources: Resources, public state: DeviceState) {
    this.globals = (root.globals_list as Env['globals']) ?? {};
    this.functions = createFunctions({ state, global: (n) => this.global(n) });
    this.fctx = { functions: this.functions, warn: (m) => this.warnings.add(m) };
  }

  global(name: string): Value | undefined {
    const g = this.globals[name] ?? this.globals[name.toLowerCase()];
    if (!g) return undefined;
    // GlobalsContext guards against recursive globals the same way (max depth ~3).
    const depth = this.globalDepth.get(name) ?? 0;
    if (depth > 3) return '';
    this.globalDepth.set(name, depth + 1);
    try {
      if (((g.toggles ?? 0) & 10) === 10 && g.global_formula) return evaluateValue(g.global_formula, this.fctx);
      const v = g.value;
      return typeof v === 'number' ? v : v === undefined || v === null ? '' : String(v);
    } finally {
      this.globalDepth.set(name, depth);
    }
  }
}

class Mod {
  readonly type: string;
  readonly children: Mod[];
  box: Box = { w: 0, h: 0, pad: [0, 0, 0, 0] };

  constructor(readonly json: ModuleJson, readonly parent: Mod | null, readonly env: Env) {
    this.type = String(json.internal_type ?? '');
    const items = Array.isArray(json.viewgroup_items) ? (json.viewgroup_items as ModuleJson[]) : [];
    this.children = isLayerType(this.type) ? items.map((c) => new Mod(c, this, env)) : [];
  }

  get isLayer() {
    return isLayerType(this.type);
  }

  get onRoot() {
    return this.parent?.type === 'RootLayerModule';
  }

  private sub(key: string): Record<string, unknown> | undefined {
    const v = this.json[key];
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  }

  /** RenderModule.getValue(): global > formula > stored value > spec default. */
  value(key: string): unknown {
    const toggle = Number(this.sub('internal_toggles')?.[key] ?? 0);
    let v: unknown;
    if ((toggle & 100) === 100) {
      const name = this.sub('internal_globals')?.[key];
      if (typeof name === 'string') v = this.env.global(name);
    } else if ((toggle & 10) === 10) {
      const f = this.sub('internal_formulas')?.[key];
      if (typeof f === 'string' && f.length > 0) v = evaluateValue(f, this.env.fctx);
    }
    if (v === undefined || v === null) v = this.json[key];
    if (v === undefined || v === null) v = moduleDefault(this.type, key, this.onRoot);
    return v;
  }

  str(key: string): string {
    const v = this.value(key);
    return v === undefined || v === null ? '' : typeof v === 'number' ? valueToString(v) : String(v);
  }

  num(key: string): number {
    const v = this.value(key);
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    if (typeof v === 'string' && isNumeric(v)) return parseFloat(v);
    return 0;
  }

  /** getEnum(): unknown values fall back to the enum's first constant. */
  enum(key: string, values: readonly string[]): string {
    const s = this.str(key).trim().toUpperCase();
    return values.includes(s) ? s : values[0];
  }

  color(key: string, fallback = '#FFFFFFFF'): string {
    return parseColor(this.str(key), fallback);
  }

  /** Pixel size for this module's own properties (scaled by ancestor layers only). */
  get unit(): number {
    return this.parent ? this.parent.childUnit : this.env.pxPerUnit;
  }

  get childUnit(): number {
    return this.unit * Math.max(0, this.num('config_scale_value')) / 100;
  }

  size(key: string): number {
    return this.num(key) * this.unit;
  }

  text(key: string): string {
    return evaluateText(this.str(key), this.env.fctx);
  }

  get visibility(): string {
    if (!this.isLayer || this.type === 'RootLayerModule') return 'ALWAYS';
    return this.enum('config_visible', VISIBLE);
  }

  get removed() {
    return this.visibility === 'REMOVE';
  }

  get visible() {
    const v = this.visibility;
    return v === 'ALWAYS' || v === 'IF_NOT_LOCKED' || v === 'IF_PORTRAIT';
  }

  userPadding(): Box['pad'] {
    return [
      Math.trunc(this.size('position_padding_left')),
      Math.trunc(this.size('position_padding_top')),
      Math.trunc(this.size('position_padding_right')),
      Math.trunc(this.size('position_padding_bottom')),
    ];
  }
}

// ---------------------------------------------------------------------------
// Rotation (options.Rotate)

function rotation(m: Mod, modeKey: string, offsetKey: string): number {
  const mode = m.enum(modeKey, ROTATE);
  const off = m.num(offsetKey);
  const d = m.env.state.now;
  switch (mode) {
    case 'MANUAL': return off;
    case 'DEG90': return 90;
    case 'DEG180': return 180;
    case 'DEG270': return 270;
    case 'CLOCK_HOUR_SMOOTH': return (((d.getHours() % 12) * 60 + d.getMinutes()) / 720) * 360 + off;
    case 'CLOCK_HOUR': return (d.getHours() % 12) * 30 + off;
    case 'CLOCK_MINUTE_SMOOTH': return ((d.getMinutes() * 60 + d.getSeconds()) / 3600) * 360 + off;
    case 'CLOCK_MINUTE': return d.getMinutes() * 6 + off;
    case 'CLOCK_SECOND_SMOOTH': return ((d.getSeconds() * 1000 + d.getMilliseconds()) / 60000) * 360 + off;
    case 'CLOCK_SECOND': return d.getSeconds() * 6 + off;
  }
  return 0;
}

function rotatedSize(w: number, h: number, deg: number): [number, number] {
  if (deg % 360 === 0) return [w, h];
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return [Math.trunc(w * c + h * s), Math.trunc(w * s + h * c)];
}

// ---------------------------------------------------------------------------
// Paint (view.q): colour, gradient, shadow and stroke shared by text, shapes and icons.

interface PaintInfo {
  stroke: boolean;
  strokeWidth: number;
  shadow: null | { dx: number; dy: number; radius: number; color: string };
  /** Extra padding reserved for the shadow (view.q.t()). */
  shadowPad: Box['pad'];
}

function paintInfo(m: Mod, objW: number, objH: number, rot: number): PaintInfo {
  const stroke = m.enum('paint_style', ['FILL', 'STROKE']) === 'STROKE';
  const strokeWidth = stroke ? Math.min(objW, objH, m.size('paint_stroke')) : 0;
  let shadow: PaintInfo['shadow'] = null;
  const shadowPad: Box['pad'] = [0, 0, 0, 0];
  if (m.enum('fx_shadow', ['NONE', 'OUTER']) === 'OUTER') {
    const dist = m.size('fx_shadow_distance');
    const dir = m.num('fx_shadow_direction');
    const blur = m.num('fx_shadow_blur');
    const a = ((360 - dir) * Math.PI) / 180;
    shadow = { dx: dist * Math.cos(a), dy: dist * Math.sin(a), radius: Math.max(1, blur * 0.25), color: m.color('fx_shadow_color', '#FF000000') };
    const a2 = ((360 - dir + rot) * Math.PI) / 180;
    const f = blur * 0.015 + 1;
    shadowPad[1] = Math.trunc(Math.max(0, -dist * Math.sin(a2) * f));
    shadowPad[3] = Math.trunc(Math.max(0, dist * Math.sin(a2) * f));
    shadowPad[0] = Math.trunc(Math.max(0, -dist * Math.cos(a2) * f));
    shadowPad[2] = Math.trunc(Math.max(0, dist * Math.cos(a2) * f));
  }
  return { stroke, strokeWidth, shadow, shadowPad };
}

function combinePad(user: Box['pad'], extra: Box['pad']): Box['pad'] {
  return user.map((v, i) => Math.max(v, extra[i])) as Box['pad'];
}

/** Sets fill/stroke style and shadow on ctx; coordinates are the object's local space. */
function applyPaint(ctx: CanvasRenderingContext2D, m: Mod, p: PaintInfo, w: number, h: number) {
  const color = m.color('paint_color');
  let style: string | CanvasGradient | CanvasPattern = color;
  const grad = m.enum('fx_gradient', GRADIENT);
  if (grad !== 'NONE') {
    const gColor = m.color('fx_gradient_color', '#FF888888');
    const width = m.num('fx_gradient_width');
    const offset = m.num('fx_gradient_offset');
    // view.q: s() = start, q() = end, r() = offset shift
    const s = (len: number) => Math.max(0, 100 - width) * 0.01 * (len / 2);
    const q = (len: number) => Math.min(100, width) * 0.01 * (len / 2) + len / 2;
    const r = (len: number) => len * (offset * 0.01 - 0.5);
    const stops = (g: CanvasGradient) => {
      g.addColorStop(0, color);
      g.addColorStop(1, gColor);
      return g;
    };
    if (grad === 'HORIZONTAL' && w > 0) {
      const a = s(w) + r(w), b = q(w) + r(w);
      if (b > a) style = stops(ctx.createLinearGradient(a, 0, b, 0));
    } else if (grad === 'VERTICAL' && h > 0) {
      const a = s(h) + r(h), b = q(h) + r(h);
      if (b > a) style = stops(ctx.createLinearGradient(0, a, 0, b));
    } else if (grad === 'RADIAL') {
      const cx = w / 2 + (m.num('fx_gradient_offset_x') * 0.01 - 0.5) * w;
      const cy = h / 2 + (m.num('fx_gradient_offset_y') * 0.01 - 0.5) * h;
      const rad = Math.max(1, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const lo = Math.min(1, Math.max(0, (s(1) + r(1)))), hi = Math.min(1, Math.max(lo, q(1) + r(1)));
      g.addColorStop(lo, color);
      g.addColorStop(hi, gColor);
      style = g;
    } else if (grad === 'SWEEP') {
      const cx = w / 2 + (m.num('fx_gradient_offset_x') * 0.01 - 0.5) * w;
      const cy = h / 2 + (m.num('fx_gradient_offset_y') * 0.01 - 0.5) * h;
      // Android sweep starts at 3 o'clock; KLWP post-rotates it by 90 degrees.
      const g = ctx.createConicGradient(Math.PI / 2, cx, cy);
      const lo = Math.min(1, Math.max(0, s(1) + r(1))), hi = Math.min(1, Math.max(lo, q(1) + r(1)));
      g.addColorStop(lo, color);
      g.addColorStop(hi, gColor);
      style = g;
    } else if (grad === 'BITMAP') {
      const img = m.env.resources.image(m.str('fx_gradient_bitmap'));
      if (img) {
        const tile = m.enum('fx_gradient_bitmap_mode', ['FIT_CENTER', 'REPEAT', 'MIRROR']);
        const pat = ctx.createPattern(img.image, tile === 'FIT_CENTER' ? 'no-repeat' : 'repeat');
        if (pat) {
          let sc: number, tx = 0, ty = 0;
          if (tile === 'FIT_CENTER') {
            sc = Math.max(w / img.width, h / img.height);
            tx = (w - img.width * sc) / 2;
            ty = (h - img.height * sc) / 2;
          } else {
            sc = m.size('fx_gradient_bitmap_width') / img.width;
          }
          pat.setTransform(new DOMMatrix([sc, 0, 0, sc, tx, ty]));
          style = pat;
        }
      }
    }
  }
  ctx.fillStyle = style;
  ctx.strokeStyle = style;
  ctx.lineWidth = p.strokeWidth;
  if (p.shadow) {
    // Canvas shadows ignore the transform, Android's are in local space: map them manually.
    const t = ctx.getTransform();
    const scale = Math.hypot(t.a, t.b);
    ctx.shadowOffsetX = t.a * p.shadow.dx + t.c * p.shadow.dy;
    ctx.shadowOffsetY = t.b * p.shadow.dx + t.d * p.shadow.dy;
    // Skia converts a blur radius to sigma = r * 0.57735 + 0.5; canvas shadowBlur = 2 * sigma.
    ctx.shadowBlur = 2 * (p.shadow.radius * 0.57735 + 0.5) * scale;
    ctx.shadowColor = p.shadow.color;
  }
}

// ---------------------------------------------------------------------------
// Text (view.c)

interface TextLayout {
  font: string;
  lines: { text: string; width: number }[];
  lineHeight: number;
  ascent: number;
  objW: number;
  objH: number;
  availW: number;
  sizeType: string;
  align: string;
}

function stripBBCode(s: string): string {
  return s.replace(/\[\/?(b|i|u|s|up|dn|c|bl|bc|f|r|size|fa|mi|img|ic)(=[^\]]*)?\]/gi, '');
}

function measureFont(ctx: CanvasRenderingContext2D, font: string) {
  ctx.font = font;
  const mt = ctx.measureText('Hg');
  return { ascent: mt.fontBoundingBoxAscent, descent: mt.fontBoundingBoxDescent };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (ctx.measureText(para).width <= maxW) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (ctx.measureText(tryLine).width <= maxW || line === '') {
        if (line === '' && ctx.measureText(word).width > maxW) {
          // Break an over-long word by characters.
          for (const ch of word) {
            if (line && ctx.measureText(line + ch).width > maxW) {
              out.push(line);
              line = '';
            }
            line += ch;
          }
        } else {
          line = tryLine;
        }
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  if (maxLines > 0 && out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return kept;
  }
  return out;
}

function layoutText(ctx: CanvasRenderingContext2D, m: Mod, text: string, pad: Box['pad']): TextLayout {
  const family = m.env.resources.font(m.str('text_family'));
  const sizeType = m.enum('text_size_type', FONT_SIZE);
  const align = m.enum('text_align', ALIGN);
  const textW = Math.trunc(m.size('text_width'));
  const textH = Math.trunc(m.size('text_height'));
  const availW = Math.max(1, (sizeType === 'SINGLE_FONT_HEIGHT' ? m.env.screenW * 2 : textW) - pad[0] - pad[2]);
  const fontAt = (px: number) => `${px}px ${family}`;
  const rawLines = text.split('\n');

  let size = m.size('text_size');
  if (sizeType === 'SINGLE_FIXED_WIDTH' || sizeType === 'FIT_TO_BOX') {
    const base = sizeType === 'FIT_TO_BOX' ? textH : availW / Math.min(5, text.length);
    if (base > 0 && text.length > 0) {
      const fm = measureFont(ctx, fontAt(base));
      const maxW = Math.max(1e-3, ...rawLines.map((l) => ctx.measureText(l).width));
      const height = rawLines.length * (fm.ascent + fm.descent);
      size = sizeType === 'SINGLE_FIXED_WIDTH' ? (base * (availW * 0.9)) / maxW : Math.min((availW * base) / maxW, (base * textH) / height);
    }
  }
  size = Math.max(0.1, size);
  const font = fontAt(size);
  const fm = measureFont(ctx, font);
  const maxLines = sizeType === 'FIXED_WIDTH' ? Math.trunc(m.num('text_lines')) : 0;
  const lines = wrapLines(ctx, text, availW, maxLines).map((t) => ({ text: t, width: ctx.measureText(t).width }));
  const lineHeight = fm.ascent + fm.descent;
  const maxLineW = Math.max(0, ...lines.map((l) => l.width));
  return {
    font,
    lines,
    lineHeight,
    ascent: fm.ascent,
    objW: sizeType === 'FIXED_WIDTH' ? textW : maxLineW,
    objH: lines.length * lineHeight,
    availW,
    sizeType,
    align,
  };
}

// ---------------------------------------------------------------------------
// Leaf measure + draw

interface LeafCache {
  objW: number;
  objH: number;
  rot: number;
  paint?: PaintInfo;
  text?: TextLayout;
  image?: { res: ReturnType<Resources['image']>; w: number; h: number; blur: number };
  icon?: { char: string; font: string; size: number; glyphSize: number; descent: number };
}

const leafCache = new WeakMap<Mod, LeafCache>();

function measureLeaf(ctx: CanvasRenderingContext2D, m: Mod): Box {
  const user = m.userPadding();
  let c: LeafCache;
  switch (m.type) {
    case 'TextModule': {
      const rot = rotation(m, 'text_rotate_mode', 'text_rotate_offset');
      const text = stripBBCode(m.text('text_expression'));
      // Shadow padding depends on the object size only through rotation, so a first pass suffices.
      const pre = paintInfo(m, 1, 1, rot);
      const t = layoutText(ctx, m, text, combinePad(user, pre.shadowPad));
      c = { objW: t.objW, objH: t.objH, rot, paint: paintInfo(m, t.objW, t.objH, rot), text: t };
      break;
    }
    case 'FontIconModule': {
      const rot = rotation(m, 'icon_rotate_mode', 'icon_rotate_offset');
      const size = m.size('icon_size');
      const set = m.env.resources.iconSet(m.str('icon_set'));
      const name = m.str('icon_icon').trim().toLowerCase();
      const code = set?.codes.get(name);
      if (set && code === undefined) m.env.warnings.add(`Icon "${name}" not found in icon set`);
      const char = code === undefined ? '' : String.fromCodePoint(code);
      const font = set ? `"${set.family}"` : DEFAULT_FONT;
      ctx.font = `${size}px ${font}`;
      // view.i.I(): shrink the glyph if its advance is wider than the icon box.
      const adv = char ? ctx.measureText(char).width : 0;
      const glyphSize = adv > size ? size / (adv / size) : size;
      ctx.font = `${glyphSize}px ${font}`;
      const descent = char ? ctx.measureText(char).fontBoundingBoxDescent : 0;
      c = { objW: size, objH: size, rot, icon: { char, font, size, glyphSize, descent } };
      c.paint = paintInfo(m, size, size, rot);
      break;
    }
    case 'ShapeModule': {
      const rot = rotation(m, 'shape_rotate_mode', 'shape_rotate_offset');
      const shape = m.enum('shape_type', SHAPES);
      const w = m.size('shape_width');
      const symmetric = shape === 'SQUARE' || shape === 'CIRCLE' || shape === 'SQUIRCLE' || shape === 'EXAGON' || shape === 'SLICE';
      let h = symmetric ? w : m.size('shape_height');
      let objW = w;
      if (shape === 'ARC') {
        const b = arcGeometry(w, h, m.num('shape_angle'));
        objW = b.w;
        h = b.h;
      }
      c = { objW, objH: h, rot };
      c.paint = paintInfo(m, w, h, rot);
      break;
    }
    case 'BitmapModule': {
      const rot = rotation(m, 'bitmap_rmode', 'bitmap_rotate');
      const mode = m.enum('bitmap_mode', ['BITMAP', 'VECTOR']);
      let uri = mode === 'VECTOR' ? m.str('bitmap_svg') : m.str('bitmap_bitmap');
      if (!uri && mode === 'VECTOR') uri = m.str('bitmap_bitmap');
      const res = m.env.resources.image(uri);
      const scale = m.enum('bitmap_scale_mode', BITMAP_SCALE);
      const bw = Math.trunc(m.size('bitmap_width'));
      const bh = Math.trunc(m.size('bitmap_height'));
      // view.d: missing images fall back to a square placeholder of the configured width.
      const iw = res?.width ?? bw;
      const ih = res?.height ?? (scale === 'FIT_HEIGHT' ? bh : bw);
      const w = scale === 'FIT_HEIGHT' ? Math.round((bh / ih) * iw) : bw;
      const h = scale === 'FIT_WIDTH' ? Math.round((bw / iw) * ih) : bh;
      c = { objW: w, objH: h, rot, image: { res, w: bw, h: bh, blur: m.num('bitmap_blur') } };
      break;
    }
    default:
      m.env.warnings.add(`Unsupported module type: ${m.type || '(none)'}`);
      c = { objW: 0, objH: 0, rot: 0 };
  }
  leafCache.set(m, c);
  // view.i (icons) measures without the stroke; text and shapes include it.
  const sw = m.type === 'FontIconModule' ? 0 : c.paint?.strokeWidth ?? 0;
  const [rw, rh] = rotatedSize(Math.trunc(c.objW + sw), Math.trunc(c.objH + sw), c.rot);
  const pad = combinePad(user, c.paint?.shadowPad ?? [0, 0, 0, 0]);
  return { w: rw + pad[0] + pad[2], h: rh + pad[1] + pad[3], pad };
}

function drawLeaf(ctx: CanvasRenderingContext2D, m: Mod) {
  const c = leafCache.get(m);
  if (!c) return;
  const { w, h, pad } = m.box;
  const sw = m.type === 'FontIconModule' ? 0 : c.paint?.strokeWidth ?? 0;
  ctx.save();
  // view.q.i() + E(): centre the object in the padded area and rotate around its centre.
  ctx.translate(pad[0] + (w - pad[0] - pad[2]) / 2, pad[1] + (h - pad[1] - pad[3]) / 2);
  if (c.rot) ctx.rotate((c.rot * Math.PI) / 180);
  ctx.translate(-c.objW / 2, -c.objH / 2);

  if (m.type === 'BitmapModule' && c.image) {
    const { res, blur } = c.image;
    if (res) {
      ctx.globalAlpha *= Math.min(1, Math.max(0, m.num('bitmap_alpha') / 100));
      if (blur > 0) {
        // utils.m: ScriptIntrinsicBlur (sigma ~ 0.4r + 0.6), halving the image above radius 25.
        let r = blur, k = 1;
        while (r > 25) { r /= 2; k *= 2; }
        ctx.filter = `blur(${(0.4 * r + 0.6) * k}px)`;
      }
      ctx.drawImage(res.image, 0, 0, c.objW, c.objH);
    }
  } else if (c.paint) {
    applyPaint(ctx, m, c.paint, c.objW + sw, c.objH + sw);
    const stroke = c.paint.stroke;
    if (c.text) {
      const t = c.text;
      ctx.font = t.font;
      ctx.textBaseline = 'alphabetic';
      const boxW = t.sizeType === 'FIXED_WIDTH' ? t.availW : t.objW;
      t.lines.forEach((line, i) => {
        const x = t.align === 'CENTER' ? (boxW - line.width) / 2 : t.align === 'RIGHT' ? boxW - line.width : 0;
        const y = i * t.lineHeight + t.ascent;
        if (stroke) ctx.strokeText(line.text, x, y);
        else ctx.fillText(line.text, x, y);
      });
    } else if (c.icon) {
      const ic = c.icon;
      if (ic.char) {
        ctx.font = `${ic.glyphSize}px ${ic.font}`;
        ctx.textBaseline = 'alphabetic';
        let y = ic.size - ic.descent;
        if (ic.size > ic.glyphSize) y -= (ic.size - ic.glyphSize) / 2;
        if (stroke) ctx.strokeText(ic.char, 0, y);
        else ctx.fillText(ic.char, 0, y);
      }
    } else if (m.type === 'ShapeModule') {
      drawShape(ctx, m, c.objW, c.objH, stroke);
    }
  }
  ctx.restore();
}

/** ARC geometry: radius so the centre line's length equals `len`, plus its bounding box. */
function arcGeometry(len: number, thickness: number, angleDeg: number) {
  const angle = Math.min(360, Math.max(1e-4, angleDeg));
  const r = (360 * len) / (angle * 2 * Math.PI);
  const a0 = ((-90 - angle / 2) * Math.PI) / 180;
  const a1 = ((-90 + angle / 2) * Math.PI) / 180;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = a0 + ((a1 - a0) * i) / 64;
    for (const rr of [r + thickness / 2, Math.max(0, r - thickness / 2)]) pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
  }
  const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
  const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
  return { cx: -minX, cy: -minY, r, t: thickness, a0, a1, w: maxX - minX, h: maxY - minY };
}

function drawShape(ctx: CanvasRenderingContext2D, m: Mod, w: number, h: number, stroke: boolean) {
  const shape = m.enum('shape_type', SHAPES);
  const corners = m.size('shape_corners');
  const p = new Path2D();
  switch (shape) {
    case 'CIRCLE':
    case 'OVAL':
      p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'TRIANGLE':
      p.moveTo(w / 2, 0);
      p.lineTo(w, h);
      p.lineTo(0, h);
      p.closePath();
      break;
    case 'RTRIANGLE':
      p.moveTo(0, 0);
      p.lineTo(w, h);
      p.lineTo(0, h);
      p.closePath();
      break;
    case 'EXAGON':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = w / 2 + (w / 2) * Math.cos(a), y = h / 2 + (h / 2) * Math.sin(a);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
    case 'SLICE': {
      // view.y.d(): ring segment from 12 o'clock, clockwise; shape_height is the ring thickness.
      const sweep = (Math.min(360, Math.max(0, m.num('shape_angle'))) * Math.PI) / 180;
      const r = w / 2;
      const inner = Math.max(0, r - Math.min(m.size('shape_height'), r));
      const a0 = -Math.PI / 2;
      p.arc(r, r, r, a0, a0 + sweep);
      p.arc(r, r, inner, a0 + sweep, a0, true);
      p.closePath();
      break;
    }
    case 'ARC': {
      // view.y.b(): a bar of length shape_width bent along shape_angle degrees, centred at the top.
      const g = arcGeometry(m.size('shape_width'), m.size('shape_height'), m.num('shape_angle'));
      p.arc(g.cx, g.cy, g.r + g.t / 2, g.a0, g.a1);
      p.arc(g.cx, g.cy, Math.max(0, g.r - g.t / 2), g.a1, g.a0, true);
      p.closePath();
      break;
    }
    case 'PATH':
      // shortcut: SVG path shapes are scaled to the box without PathScaleMode handling.
      try {
        const raw = new Path2D('M 0,0 ' + m.text('shape_path'));
        ctx.save();
        ctx.scale(w / 100, h / 100);
        if (stroke) ctx.stroke(raw);
        else ctx.fill(raw);
        ctx.restore();
      } catch {
        /* invalid path */
      }
      return;
    default:
      if (corners > 0) p.roundRect(0, 0, w, h, Math.min(corners, w / 2, h / 2));
      else p.rect(0, 0, w, h);
  }
  if (stroke) ctx.stroke(p);
  else ctx.fill(p);
}

// ---------------------------------------------------------------------------
// Layers

/** AnchorMode.toAndroidGravity() split into horizontal (-1/0/1) and vertical (-1/0/1). */
function anchorOf(m: Mod): [number, number] {
  const a = m.enum('position_anchor', ANCHORS);
  const i = ANCHORS.indexOf(a);
  return [(i % 3) - 1, Math.floor(i / 3) - 1];
}

function measure(ctx: CanvasRenderingContext2D, m: Mod): Box {
  if (!m.isLayer) return (m.box = measureLeaf(ctx, m));
  const pad = m.userPadding();
  const kids = m.children.filter((k) => !k.removed);
  kids.forEach((k) => measure(ctx, k));
  if (m.type === 'RootLayerModule') return (m.box = { w: m.env.screenW, h: m.env.screenH, pad });
  let w = 0, h = 0;
  if (m.type === 'StackLayerModule') {
    const vertical = m.enum('config_stacking', STACKING).startsWith('VERTICAL');
    const margin = Math.trunc(m.size('config_margin'));
    kids.forEach((k, i) => {
      const gap = i < kids.length - 1 ? margin : 0;
      if (vertical) {
        w = Math.max(w, k.box.w);
        h += k.box.h + gap;
      } else {
        w += k.box.w + gap;
        h = Math.max(h, k.box.h);
      }
    });
  } else {
    for (const k of kids) {
      w = Math.max(w, k.box.w);
      h = Math.max(h, k.box.h);
    }
  }
  return (m.box = { w: w + pad[0] + pad[2], h: h + pad[1] + pad[3], pad });
}

/** Horizontal SCROLL animation translation (AnimationModule.b()). */
function scrollTranslation(m: Mod): [number, number] {
  const anims = m.json.internal_animations;
  if (!Array.isArray(anims)) return [0, 0];
  const { offset, screens } = m.env.view;
  const last = Math.max(0, screens - 1);
  if (last === 0) return [0, 0];
  let tx = 0, ty = 0;
  for (const a of anims as Record<string, unknown>[]) {
    const type = String(a.type ?? 'DISABLED');
    if (type !== 'SCROLL') continue; // shortcut: vertical scroll, gyro, loops etc. are static
    const action = String(a.action ?? 'SCROLL');
    if (action !== 'SCROLL' && action !== 'SCROLL_INVERTED') continue;
    const center = String(a.center ?? 'CENTER');
    const mid = Math.ceil(last / 2);
    let screen: number;
    if (center === 'CENTER') screen = mid;
    else if (center === 'FIRST') screen = 0;
    else if (center === 'LAST') screen = last;
    else if (center.startsWith('CENTER_M')) screen = Math.max(0, mid - Number(center.slice(8)));
    else if (center.startsWith('CENTER_P')) screen = Math.min(last, mid + Number(center.slice(8)));
    else screen = Number(center.replace('SCREEN', '')) - 1;
    const rule = String(a.rule ?? 'CENTER');
    const dist = offset - screen / last;
    if ((rule === 'UP_TO_CENTER' || rule === 'BEFORE_CENTER') && dist > 0) continue;
    if ((rule === 'FROM_CENTER' || rule === 'AFTER_CENTER') && dist < 0) continue;
    const speed = Number(a.speed ?? 100);
    let d = (screen / last - offset) * m.env.screenW * (speed / 100);
    if (action === 'SCROLL_INVERTED') d = -d;
    const limit = Number(a.limit ?? 0);
    if (limit > 0) {
      const lim = limit * m.unit;
      d = Math.max(-lim, Math.min(lim, d));
    }
    const ang = (Number(a.angle ?? 0) * Math.PI) / 180;
    tx += d * Math.cos(ang);
    ty += d * Math.sin(ang);
  }
  return [tx, ty];
}

function draw(ctx: CanvasRenderingContext2D, m: Mod) {
  if (!m.visible) return;
  if (!m.isLayer) {
    drawLeaf(ctx, m);
    return;
  }
  ctx.save();
  if (m.type !== 'RootLayerModule') {
    ctx.globalAlpha *= Math.min(1, Math.max(0, m.num('config_alpha') / 100));
    const rot = rotation(m, 'config_rotate_mode', 'config_rotate_offset');
    if (rot) {
      ctx.translate(m.box.w / 2, m.box.h / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-m.box.w / 2, -m.box.h / 2);
    }
  }
  const [pl, pt, pr, pb] = m.box.pad;
  const innerW = m.box.w - pl - pr;
  const innerH = m.box.h - pt - pb;
  const kids = m.children.filter((k) => !k.removed);

  if (m.type === 'StackLayerModule') {
    const stacking = m.enum('config_stacking', STACKING);
    const vertical = stacking.startsWith('VERTICAL');
    const margin = Math.trunc(m.size('config_margin'));
    const cross = ['VERTICAL_LEFT', 'HORIZONTAL_TOP'].includes(stacking) ? -1 : ['VERTICAL_RIGHT', 'HORIZONTAL_BOTTOM'].includes(stacking) ? 1 : 0;
    let pos = 0;
    for (const k of kids) {
      let x: number, y: number;
      if (vertical) {
        x = pl + (cross < 0 ? 0 : cross > 0 ? innerW - k.box.w : Math.trunc((innerW - k.box.w) / 2));
        y = pt + pos;
        pos += k.box.h + margin;
      } else {
        x = pl + pos;
        y = pt + (cross < 0 ? 0 : cross > 0 ? innerH - k.box.h : Math.trunc((innerH - k.box.h) / 2));
        pos += k.box.w + margin;
      }
      drawChild(ctx, k, x, y);
    }
  } else {
    // Root and overlap layers: gravity placement (view.g); only root children use offsets.
    const isRoot = m.type === 'RootLayerModule';
    for (const k of kids) {
      const [ax, ay] = anchorOf(k);
      const ox = isRoot ? Math.trunc(k.size('position_offset_x')) : 0;
      const oy = isRoot ? Math.trunc(k.size('position_offset_y')) : 0;
      const x = pl + (ax < 0 ? ox : ax > 0 ? innerW - k.box.w - ox : Math.trunc((innerW - k.box.w) / 2) + ox);
      const y = pt + (ay < 0 ? oy : ay > 0 ? innerH - k.box.h - oy : Math.trunc((innerH - k.box.h) / 2) + oy);
      drawChild(ctx, k, x, y);
    }
  }
  ctx.restore();
}

function drawChild(ctx: CanvasRenderingContext2D, k: Mod, x: number, y: number) {
  const [tx, ty] = scrollTranslation(k);
  ctx.save();
  ctx.translate(x + tx, y + ty);
  if (k.env.onBox && k.visible) {
    const t = ctx.getTransform();
    const pts = [[0, 0], [k.box.w, 0], [0, k.box.h], [k.box.w, k.box.h]].map(([px, py]) => [t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const bx = Math.min(...xs), by = Math.min(...ys);
    k.env.onBox({ json: k.json, x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by });
  }
  draw(ctx, k);
  ctx.restore();
}

// ---------------------------------------------------------------------------

export class KlwpRenderer {
  private root: Mod;
  private env: Env;
  readonly info: PresetInfo;

  constructor(preset: { info: PresetInfo; root: ModuleJson }, resources: Resources, state: DeviceState) {
    this.info = preset.info;
    this.env = new Env(preset.root, resources, state);
    this.root = new Mod(preset.root, null, this.env);
  }

  /** Highest home screen any scroll animation is pinned to (SCREENn), so nothing is unreachable. */
  get referencedScreens(): number {
    let max = 1;
    const walk = (m: Mod) => {
      const anims = m.json.internal_animations;
      if (Array.isArray(anims)) {
        for (const a of anims as Record<string, unknown>[]) {
          const n = /^SCREEN(\d)$/.exec(String(a.center ?? ''));
          if (n) max = Math.max(max, Number(n[1]));
        }
      }
      m.children.forEach(walk);
    };
    walk(this.root);
    return max;
  }

  get warnings(): string[] {
    return [...this.env.warnings];
  }

  /** Renders one frame at the canvas' current pixel size; `onBox` receives each module's bounds. */
  render(ctx: CanvasRenderingContext2D, view: ViewState, onBox?: (box: ModuleBox) => void) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const env = this.env;
    env.screenW = W;
    env.screenH = H;
    env.view = view;
    env.onBox = onBox;
    env.pxPerUnit = Math.min(W, H) / 720;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    this.drawBackground(ctx, W, H, view);
    measure(ctx, this.root);
    draw(ctx, this.root);
    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, view: ViewState) {
    const root = this.root;
    ctx.fillStyle = root.color('background_color', '#FF333333');
    ctx.fillRect(0, 0, W, H);
    if (root.enum('background_type', ['SOLID', 'IMAGE']) !== 'IMAGE') return;
    const img = this.env.resources.image(root.str('background_bitmap'));
    if (!img) return;
    // Wallpaper image covers the screen; extra width pans with the launcher (BackgroundScroll).
    const sc = Math.max(W / img.width, H / img.height);
    const dw = img.width * sc, dh = img.height * sc;
    const scroll = root.enum('background_scroll', ['NORMAL', 'NONE', 'INVERTED']);
    const t = scroll === 'NORMAL' ? view.offset : scroll === 'INVERTED' ? 1 - view.offset : 0.5;
    ctx.drawImage(img.image, -(dw - W) * t, -(dh - H) / 2, dw, dh);
  }
}
