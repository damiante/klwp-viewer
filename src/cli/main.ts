// klwp: command-line editor/renderer for Kustom Live Wallpaper presets, built for scripts
// and LLM agents. Every command prints plain text, or JSON with --json.

import { type Canvas, type SKRSContext2D, createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { unzipSync } from 'fflate';
import { type ModuleJson, KFILE_PREFIX, kfilePath } from '../klwp/archive';
import { EditError, KlwpDocument, type PropValue } from '../klwp/document';
import { evaluateText } from '../klwp/formula';
import { createFunctions, defaultDeviceState, type DeviceState } from '../klwp/functions';
import { type Op, applyOps } from '../klwp/ops';
import { type ModuleBox, KlwpRenderer } from '../klwp/render';
import { Resources, parseIconNames } from '../klwp/resources';
import { MODULE_TYPES, SCHEMA, isLayerType, moduleDefault, moduleProps } from '../klwp/schema';
import { nodePlatform } from './node-platform';

const HELP = `klwp — edit, validate and render Kustom Live Wallpaper (.klwp) presets

Usage: klwp <command> [args] [options]

Reading
  inspect <file> [--target REF] [--json]     Module tree with paths, types, titles and key settings
  get <file> <REF> [--all]                   One module's settings (--all adds every default)
  validate <file> [--json]                   Check properties, formulas, globals, assets; exit 1 on errors
  assets <file>                              Archive files and whether they are referenced
  icons <file> [--set PATH] [--search TEXT]  Icon sets in the archive, or icon names in one set
  eval <file> <formula> [device options]     Evaluate a formula, e.g. '$df(EEEE)$'
  schema [Type] [--json]                     Module types and every property (type, default, values)

Writing (in place unless -o is given; thumbnails are regenerated unless --no-thumbs;
         --prune drops archive files nothing references, do this for the final export)
  new <file> [--title T] [--width 540] [--height 1200] [--screens 3] [--force]
  apply <file> [OPS_FILE|-] [--ops JSON] [-o OUT] [--dry-run]   Apply a JSON array of operations
  set <file> <REF> key=value...  [-o OUT]   Quick property edits (value: number, text, or JSON)
  asset-add <file> <asset> [--json ICONS.json] [--kind font|bitmap|icons] [-o OUT]
  import <file> --from <zip|apk|klwp> <member>...   Copy fonts/icon sets/images from another archive

Rendering
  render <file> -o out.png [--screen N | --all] [--outline] [--boxes] [--compare REF.png] [--scale 0.5] [device options]
      --outline labels every module box with its path; --boxes prints boxes as JSON (units);
      --compare puts a reference image beside the render

Device options: --time 2025-10-23T19:29 --dark --paused --battery 40 --screens N

REF: "/" root, "/0/2" child path, "#Title" unique module title, "@alias" (within one apply batch).
`;

const die = (msg: string): never => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

function load(file: string): KlwpDocument {
  if (!existsSync(file)) die(`${file} not found`);
  try {
    return KlwpDocument.fromBytes(new Uint8Array(readFileSync(file)));
  } catch (e) {
    return die(`${file}: ${(e as Error).message}`);
  }
}

function deviceState(o: Record<string, unknown>): DeviceState {
  const s = defaultDeviceState(o.time ? new Date(String(o.time)) : new Date());
  if (isNaN(s.now.getTime())) die(`--time: cannot parse "${o.time}"`);
  for (const d of [s.sunrise, s.sunset]) d.setFullYear(s.now.getFullYear(), s.now.getMonth(), s.now.getDate());
  s.darkMode = Boolean(o.dark);
  if (o.paused) s.music.state = 'PAUSED';
  if (o.battery !== undefined) s.battery.level = Number(o.battery);
  return s;
}

function screenCount(doc: KlwpDocument, r: KlwpRenderer, o: Record<string, unknown>): number {
  return Math.max(1, Number(o.screens) || Math.max(Number(doc.info.xscreens) || 3, r.referencedScreens));
}

// --- Rendering ---------------------------------------------------------------

async function renderer(doc: KlwpDocument, state: DeviceState) {
  const res = await Resources.load(doc.files, nodePlatform);
  return { r: new KlwpRenderer(doc, res, state), res };
}

/** Renders one screen at device resolution (2x the preset size, like a 1080px-wide phone). */
function renderScreen(doc: KlwpDocument, r: KlwpRenderer, offset: number, screens: number, w?: number, h?: number, onBox?: (b: ModuleBox) => void): Canvas {
  const c = createCanvas(w ?? Number(doc.info.width) * 2, h ?? Number(doc.info.height) * 2);
  r.render(c.getContext('2d') as unknown as CanvasRenderingContext2D, { offset, screens }, onBox);
  return c;
}

function drawOutlines(ctx: SKRSContext2D, boxes: { path: string; box: ModuleBox }[]) {
  const colors = ['#ff1744', '#2979ff', '#00c853', '#ff9100', '#d500f9', '#00b8d4'];
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = 'bold 20px sans-serif';
  for (const { path, box } of boxes) {
    const color = colors[(path.split('/').length - 2) % colors.length];
    ctx.strokeStyle = color;
    ctx.setLineDash(isLayerType(String(box.json.internal_type)) ? [8, 6] : []);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    const tw = ctx.measureText(path).width + 8;
    ctx.fillStyle = color;
    ctx.fillRect(box.x, box.y, tw, 24);
    ctx.fillStyle = '#fff';
    ctx.fillText(path, box.x + 4, box.y + 19);
  }
  ctx.restore();
}

async function cmdRender(file: string, o: Record<string, unknown>) {
  if (!o.output) die('render needs -o out.png');
  const doc = load(file);
  const { r, res } = await renderer(doc, deviceState(o));
  const screens = screenCount(doc, r, o);
  const last = Math.max(1, screens - 1);
  const list = o.all ? [...Array(screens).keys()] : [Math.min(screens, Math.max(1, Number(o.screen) || Math.ceil(last / 2) + 1)) - 1];
  const scale = Number(o.scale ?? 0.5);
  const W = Math.round(Number(doc.info.width) * 2 * scale);
  const H = Math.round(Number(doc.info.height) * 2 * scale);
  // --compare puts a reference image (e.g. the design being reproduced) first, at the same height.
  const ref = o.compare ? await loadImage(readFileSync(String(o.compare))).catch(() => die(`cannot read image ${o.compare}`)) : null;
  const refW = ref ? Math.round((ref.width / ref.height) * H) : 0;
  const panels = list.length + (ref ? 1 : 0);
  const gap = panels > 1 ? 16 : 0;
  const label = panels > 1 ? 36 : 0;
  const x0 = ref ? refW + gap : 0;
  const out = createCanvas(x0 + W * list.length + gap * (list.length - 1), H + label);
  const octx = out.getContext('2d');
  if (label) {
    octx.fillStyle = '#202024';
    octx.fillRect(0, 0, out.width, out.height);
    octx.fillStyle = '#ddd';
    octx.font = '20px sans-serif';
  }
  if (ref) {
    octx.drawImage(ref, 0, label, refW, H);
    octx.fillText('Reference', 8, 25);
  }
  const allBoxes: Record<string, unknown>[] = [];
  list.forEach((s, i) => {
    const boxes: { path: string; box: ModuleBox }[] = [];
    const c = renderScreen(doc, r, screens > 1 ? s / last : 0, screens, undefined, undefined, (box) => {
      const path = doc.pathOf(box.json);
      if (path) boxes.push({ path, box });
    });
    const ctx = c.getContext('2d');
    if (o.outline) drawOutlines(ctx, boxes);
    octx.drawImage(c, x0 + i * (W + gap), label, W, H);
    if (label) octx.fillText(`Screen ${s + 1}`, x0 + i * (W + gap) + 8, 25);
    // Boxes are reported in KLWP units (720 across the screen's short side), like module sizes.
    const u = 720 / Math.min(c.width, c.height);
    for (const b of boxes) {
      const visible = b.box.x + b.box.w > 0 && b.box.x < c.width && b.box.y + b.box.h > 0 && b.box.y < c.height;
      if (visible) allBoxes.push({ screen: s + 1, path: b.path, type: b.box.json.internal_type, title: b.box.json.internal_title, x: Math.round(b.box.x * u), y: Math.round(b.box.y * u), w: Math.round(b.box.w * u), h: Math.round(b.box.h * u) });
    }
  });
  writeFileSync(String(o.output), out.toBuffer('image/png'));
  const notes = [...[...res.missing].map((m) => `missing asset: ${m}`), ...r.warnings];
  if (o.boxes) console.log(JSON.stringify({ units: '720 units = screen short side', boxes: allBoxes }, null, 1));
  else console.log(`wrote ${o.output} (${out.width}x${out.height}, screens ${list.map((s) => s + 1).join(',')} of ${screens})`);
  for (const n of notes) console.error(`note: ${n}`);
}

async function save(doc: KlwpDocument, out: string, o: Record<string, unknown>) {
  let thumbs: { portrait?: Uint8Array; landscape?: Uint8Array } | undefined;
  if (!o['no-thumbs']) {
    const { r } = await renderer(doc, defaultDeviceState());
    const screens = screenCount(doc, r, {});
    const mid = screens > 1 ? Math.ceil((screens - 1) / 2) / (screens - 1) : 0;
    const shot = (w: number, h: number) => {
      const c = renderScreen(doc, r, mid, screens, w, h);
      const t = createCanvas(Math.round(w / 2.35), Math.round(h / 2.35));
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      return new Uint8Array(t.toBuffer('image/jpeg', 85));
    };
    const W = Number(doc.info.width) * 2, H = Number(doc.info.height) * 2;
    thumbs = { portrait: shot(W, H), landscape: shot(H, W) };
  }
  // Keep unreferenced assets by default: agents often import a font or icon set before using it.
  writeFileSync(out, doc.toBytes({ thumbs, keepUnused: !o.prune }));
}

// --- Inspect -----------------------------------------------------------------

const base = (uri: unknown) => (typeof uri === 'string' && uri ? basename(kfilePath(uri) ?? uri) : '');

function describe(m: ModuleJson): string {
  const t = String(m.internal_type);
  const f = (m.internal_formulas ?? {}) as Record<string, string>;
  const g = (m.internal_globals ?? {}) as Record<string, string>;
  const tg = (m.internal_toggles ?? {}) as Record<string, number>;
  const val = (k: string) => {
    if ((tg[k] ?? 0) & 100 && g[k]) return `gv:${g[k]}`;
    if ((tg[k] ?? 0) & 10 && f[k]) return `ƒ${JSON.stringify(f[k])}`;
    const v = m[k];
    return v === undefined ? undefined : typeof v === 'string' ? (v.startsWith('kfile://') ? base(v) : v) : String(v);
  };
  const parts: string[] = [];
  const show = (label: string, k: string) => {
    const v = val(k);
    if (v !== undefined && v !== '') parts.push(`${label}=${v}`);
  };
  switch (t) {
    case 'RootLayerModule':
      show('bg', 'background_type');
      show('color', 'background_color');
      show('image', 'background_bitmap');
      break;
    case 'StackLayerModule':
      show('stack', 'config_stacking');
      show('margin', 'config_margin');
      break;
    case 'TextModule':
      parts.push(JSON.stringify(val('text_expression') ?? moduleDefault(t, 'text_expression')));
      show('font', 'text_family');
      show('mode', 'text_size_type');
      show('size', 'text_size');
      show('w', 'text_width');
      show('color', 'paint_color');
      break;
    case 'ShapeModule':
      show('shape', 'shape_type');
      show('w', 'shape_width');
      show('h', 'shape_height');
      show('color', 'paint_color');
      break;
    case 'BitmapModule':
      show('svg', 'bitmap_svg');
      show('image', 'bitmap_bitmap');
      show('w', 'bitmap_width');
      break;
    case 'FontIconModule':
      parts.push(`${base(m.icon_set) || 'material.ttf'}:${val('icon_icon') ?? 'star'}`);
      show('size', 'icon_size');
      show('color', 'paint_color');
      break;
  }
  if (isLayerType(t) && t !== 'RootLayerModule') show('scale', 'config_scale_value');
  show('anchor', 'position_anchor');
  show('dx', 'position_offset_x');
  show('dy', 'position_offset_y');
  if (t !== 'RootLayerModule') show('visible', 'config_visible');
  const anims = Array.isArray(m.internal_animations) ? (m.internal_animations as Record<string, unknown>[]) : [];
  for (const a of anims) parts.push(`anim=${a.type}${a.center ? '@' + a.center : ''}`);
  if (Array.isArray(m.internal_events) && m.internal_events.length) parts.push(`events=${m.internal_events.length}`);
  return parts.join(' ');
}

function cmdInspect(file: string, o: Record<string, unknown>) {
  const doc = load(file);
  const start = o.target ? doc.resolve(String(o.target)) : doc.root;
  const startPath = doc.pathOf(start)!;
  if (o.json) {
    const tree = (m: ModuleJson, path: string): unknown => ({
      path,
      type: m.internal_type,
      title: m.internal_title,
      summary: describe(m),
      children: KlwpDocument.children(m).map((c, i) => tree(c, path === '/' ? `/${i}` : `${path}/${i}`)),
    });
    console.log(JSON.stringify({ info: doc.info, globals: doc.globals(), tree: tree(start, startPath) }, null, 1));
    return;
  }
  const i = doc.info;
  console.log(`"${i.title}" ${i.width}x${i.height} units, ${i.xscreens} screens`);
  const globals = Object.entries(doc.globals());
  if (globals.length) {
    console.log('globals:');
    for (const [name, g] of globals) console.log(`  ${name} (${g.type}) = ${g.global_formula ? `ƒ${JSON.stringify(g.global_formula)}` : JSON.stringify(g.value)}`);
  }
  doc.walk((m, path) => {
    if (startPath !== '/' && path !== startPath && !path.startsWith(startPath + '/')) return;
    const depth = path === '/' ? 0 : path.split('/').length - 1;
    const title = m.internal_title ? ` "${m.internal_title}"` : '';
    console.log(`${'  '.repeat(depth)}${path.padEnd(10 - Math.min(8, depth * 2))} ${String(m.internal_type).replace('Module', '')}${title} ${describe(m)}`);
  });
}

function cmdGet(file: string, ref: string, o: Record<string, unknown>) {
  const doc = load(file);
  const m = doc.resolve(ref);
  const out: Record<string, unknown> = { path: doc.pathOf(m) };
  for (const [k, v] of Object.entries(m)) if (k !== 'viewgroup_items') out[k] = v;
  if (Array.isArray(m.viewgroup_items)) out.children = (m.viewgroup_items as ModuleJson[]).length;
  if (o.all) {
    const parent = doc.parentOf(m);
    const defaults: Record<string, unknown> = {};
    for (const d of moduleProps(String(m.internal_type))) if (!(d.key in m)) defaults[d.key] = moduleDefault(String(m.internal_type), d.key, parent === doc.root);
    out.defaults = defaults;
  }
  console.log(JSON.stringify(out, null, 1));
}

// --- Writing -----------------------------------------------------------------

function parseOps(src: string): Op[] {
  try {
    const v = JSON.parse(src) as unknown;
    return (Array.isArray(v) ? v : [v]) as Op[];
  } catch (e) {
    return die(`ops are not valid JSON: ${(e as Error).message}`);
  }
}

async function cmdApply(file: string, opsFile: string | undefined, o: Record<string, unknown>) {
  const doc = load(file);
  const src = o.ops ? String(o.ops) : !opsFile || opsFile === '-' ? readFileSync(0, 'utf8') : readFileSync(opsFile, 'utf8');
  const ops = parseOps(src);
  let results;
  try {
    results = applyOps(doc, ops, { readFile: (p) => new Uint8Array(readFileSync(p)) });
  } catch (e) {
    return die((e as Error).message);
  }
  const issues = doc.validate().filter((i) => i.level === 'error');
  if (!o['dry-run']) await save(doc, String(o.output ?? file), o);
  console.log(JSON.stringify({ written: o['dry-run'] ? null : String(o.output ?? file), results, errors: issues }, null, 1));
}

function parseValue(v: string): PropValue {
  if (v === 'null') return null;
  if (/^[-+]?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('{')) {
    try {
      return JSON.parse(v) as PropValue;
    } catch {
      /* plain text */
    }
  }
  return v;
}

async function cmdSet(file: string, ref: string, pairs: string[], o: Record<string, unknown>) {
  const props: Record<string, PropValue> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i < 1) die(`expected key=value, got "${p}"`);
    props[p.slice(0, i)] = parseValue(p.slice(i + 1));
  }
  const doc = load(file);
  try {
    applyOps(doc, [{ op: 'set', target: ref, props }]);
  } catch (e) {
    die((e as Error).message);
  }
  await save(doc, String(o.output ?? file), o);
  console.log(`updated ${ref}`);
}

async function cmdNew(file: string, o: Record<string, unknown>) {
  if (existsSync(file) && !o.force) die(`${file} exists (use --force to overwrite)`);
  const doc = KlwpDocument.create({
    title: String(o.title ?? basename(file).replace(/\.klwp$/, '')),
    width: Number(o.width ?? 540),
    height: Number(o.height ?? 1200),
    xscreens: Number(o.screens ?? 3),
  });
  await save(doc, file, o);
  console.log(`created ${file}`);
}

async function cmdAssetAdd(file: string, asset: string, o: Record<string, unknown>) {
  const doc = load(file);
  let uri: string;
  try {
    uri = doc.addAsset(new Uint8Array(readFileSync(asset)), asset, {
      kind: o.kind as 'font' | 'bitmap' | 'icons' | undefined,
      iconJson: o.json ? new Uint8Array(readFileSync(String(o.json))) : undefined,
    });
  } catch (e) {
    return die((e as Error).message);
  }
  await save(doc, String(o.output ?? file), { ...o, 'no-thumbs': true });
  console.log(uri);
}

/** Copies members from another zip (a .klwp, or the KLWP .apk's assets/) into this preset. */
async function cmdImport(file: string, members: string[], o: Record<string, unknown>) {
  if (!o.from) die('import needs --from <archive>');
  const doc = load(file);
  const src = unzipSync(new Uint8Array(readFileSync(String(o.from))));
  if (!members.length) {
    const list = Object.keys(src).filter((k) => /^(assets\/)?(fonts|icons|bitmaps)\//.test(k));
    console.log(list.join('\n'));
    return;
  }
  for (const member of members) {
    const bytes = src[member];
    if (!bytes) die(`${member} not found in ${o.from}`);
    const rel = member.replace(/^assets\//, '');
    let uri: string;
    if (rel.startsWith('icons/') && /\.ttf$/.test(rel)) {
      const json = src[member.replace(/\.ttf$/, '.json')];
      if (!json) die(`${member}: icon sets need the matching .json`);
      uri = doc.addAsset(bytes, basename(rel), { kind: 'icons', iconJson: json });
    } else if (rel.startsWith('fonts/')) {
      uri = doc.addAsset(bytes, basename(rel), { kind: 'font' });
    } else {
      uri = doc.addAsset(bytes, basename(rel), { kind: 'bitmap' });
    }
    console.log(`${member} -> ${uri}`);
  }
  await save(doc, String(o.output ?? file), { ...o, 'no-thumbs': true });
}

// --- Reference ---------------------------------------------------------------

function cmdValidate(file: string, o: Record<string, unknown>) {
  const issues = load(file).validate();
  if (o.json) console.log(JSON.stringify(issues, null, 1));
  else if (!issues.length) console.log('ok: no issues');
  else for (const i of issues) console.log(`${i.level}: ${i.path} ${i.message}`);
  if (issues.some((i) => i.level === 'error')) process.exit(1);
}

function cmdAssets(file: string) {
  const doc = load(file);
  const refs = doc.referencedFiles();
  for (const [path, bytes] of doc.files) {
    if (path === 'preset.json') continue;
    const used = refs.has(path) ? 'used  ' : path.startsWith('preset_thumb') ? 'thumb ' : 'unused';
    console.log(`${used} ${String(bytes.length).padStart(9)}  ${path.startsWith('preset_thumb') ? path : KFILE_PREFIX + path}`);
  }
}

function cmdIcons(file: string, o: Record<string, unknown>) {
  const doc = load(file);
  const sets = [...doc.files.keys()].filter((k) => k.startsWith('icons/') && k.endsWith('.json'));
  if (!o.set) {
    if (!sets.length) console.log('no icon sets in this preset (see `klwp import --from <klwp|apk>`)');
    for (const s of sets) console.log(`${KFILE_PREFIX}${s.replace(/\.json$/, '.ttf')}  (${parseIconNames(doc.files.get(s)!).size} icons)`);
    return;
  }
  const want = String(o.set).replace(KFILE_PREFIX, '').replace(/\.ttf$/, '.json');
  const path = sets.find((s) => s === want || s === `icons/${want}` || basename(s) === basename(want));
  if (!path) return die(`no icon set ${o.set}; available: ${sets.join(', ')}`);
  const q = String(o.search ?? '').toLowerCase();
  const names = [...parseIconNames(doc.files.get(path)!).keys()].filter((n) => n.includes(q)).sort();
  console.log(names.join('\n'));
}

function cmdSchema(type: string | undefined, o: Record<string, unknown>) {
  if (type && !(type in SCHEMA)) die(`unknown type ${type}; types: ${MODULE_TYPES.join(', ')}`);
  const types = type ? [type as keyof typeof SCHEMA] : MODULE_TYPES;
  if (o.json) {
    console.log(JSON.stringify(Object.fromEntries(types.map((t) => [t, SCHEMA[t]])), null, 1));
    return;
  }
  for (const t of types) {
    console.log(`\n## ${t}\n${SCHEMA[t].desc}`);
    for (const s of SCHEMA[t].sections) {
      console.log(`  [${s.name}]`);
      for (const d of s.props) {
        const vals = d.values ? ` {${d.values.join('|')}}` : '';
        console.log(`    ${d.key} (${d.type}${vals}) default=${JSON.stringify(d.default)} — ${d.desc}`);
      }
    }
  }
}

function cmdEval(file: string, formula: string, o: Record<string, unknown>) {
  const doc = load(file);
  const warnings: string[] = [];
  const globals = doc.globals();
  const fns = createFunctions({
    state: deviceState(o),
    global: (n) => {
      const g = globals[n];
      return g ? (g.global_formula ? evaluateText(g.global_formula, { functions: fns }) : (g.value as string | number)) : undefined;
    },
  });
  console.log(evaluateText(formula, { functions: fns, warn: (w) => warnings.push(w) }));
  for (const w of warnings) console.error(`warning: ${w}`);
}

// --- Entry -------------------------------------------------------------------

async function main() {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      json: { type: 'boolean' },
      target: { type: 'string' },
      all: { type: 'boolean' },
      ops: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'no-thumbs': { type: 'boolean' },
      prune: { type: 'boolean' },
      force: { type: 'boolean' },
      title: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      screens: { type: 'string' },
      screen: { type: 'string' },
      scale: { type: 'string' },
      outline: { type: 'boolean' },
      boxes: { type: 'boolean' },
      compare: { type: 'string' },
      time: { type: 'string' },
      dark: { type: 'boolean' },
      paused: { type: 'boolean' },
      battery: { type: 'string' },
      kind: { type: 'string' },
      from: { type: 'string' },
      set: { type: 'string' },
      search: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, a, b, ...rest] = positionals;
  const need = (v: string | undefined, what: string) => v ?? die(`${cmd} needs ${what}`);
  try {
    switch (cmd) {
      case 'inspect': return cmdInspect(need(a, '<file>'), o);
      case 'get': return cmdGet(need(a, '<file>'), need(b, '<REF>'), o);
      case 'validate': return cmdValidate(need(a, '<file>'), o);
      case 'assets': return cmdAssets(need(a, '<file>'));
      case 'icons': return cmdIcons(need(a, '<file>'), o);
      case 'schema': return cmdSchema(a, o);
      case 'eval': return cmdEval(need(a, '<file>'), need(b, '<formula>'), o);
      case 'new': return await cmdNew(need(a, '<file>'), o);
      case 'apply': return await cmdApply(need(a, '<file>'), b, o);
      case 'set': return await cmdSet(need(a, '<file>'), need(b, '<REF>'), rest, o);
      case 'asset-add': return await cmdAssetAdd(need(a, '<file>'), need(b, '<asset file>'), o);
      case 'import': return await cmdImport(need(a, '<file>'), [b, ...rest].filter(Boolean) as string[], o);
      case 'render': return await cmdRender(need(a, '<file>'), o);
      default:
        console.log(HELP);
        if (cmd && cmd !== 'help' && !o.help) process.exit(1);
    }
  } catch (e) {
    if (e instanceof EditError) die(e.message);
    throw e;
  }
}

await main();
