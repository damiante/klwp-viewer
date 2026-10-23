// Editable KLWP document: the module tree, globals and archive files, with validated edits.
// Shared by the web editor and the CLI so both produce identical presets.

import { KFILE_PREFIX, type KlwpArchive, type ModuleJson, type PresetInfo, kfilePath, readKlwp, writeKlwp } from './archive';
import { type FormulaContext, evaluateText, splitSegments } from './formula';
import { createFunctions, defaultDeviceState } from './functions';
import { parseIconNames } from './resources';
import { COLOR_RE, ENUMS, MODULE_TYPES, checkValue, isLayerType, isModuleType, moduleProps, propDef } from './schema';

/** A property value: a literal, a formula, a global binding, or null to reset to the default. */
export type PropValue = string | number | null | { formula: string } | { global: string };

export interface ModuleSpec {
  type: string;
  title?: string;
  props?: Record<string, PropValue>;
  animations?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  children?: ModuleSpec[];
  /** Name to refer to this module later in the same batch as "@name". */
  as?: string;
}

export interface GlobalSpec {
  type: string;
  value?: string | number;
  formula?: string;
  title?: string;
  description?: string;
}

export interface GlobalJson {
  index: number;
  type: string;
  title: string;
  value?: unknown;
  toggles?: number;
  global_formula?: string;
  description?: string;
}

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export class EditError extends Error {}

const DEFAULT_INFO: PresetInfo = {
  version: 14,
  title: 'untitled',
  description: '',
  width: 540,
  height: 1200,
  xscreens: 3,
  yscreens: 1,
  features: '',
};

/** cyrb128: small sync hash used to name assets like the app's IMG<md5>/SVG<md5>. */
function hash128(bytes: Uint8Array): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < bytes.length; i++) {
    const k = bytes[i];
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

const sub = (m: ModuleJson, key: string): Record<string, unknown> => {
  const v = m[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  const o: Record<string, unknown> = {};
  m[key] = o;
  return o;
};

function dropEmpty(m: ModuleJson, key: string) {
  const v = m[key];
  if (v && typeof v === 'object' && Object.keys(v).length === 0) delete m[key];
}

export class KlwpDocument {
  info: PresetInfo;
  root: ModuleJson;
  files: Map<string, Uint8Array>;

  constructor(archive: KlwpArchive) {
    this.info = archive.info;
    this.root = archive.root;
    this.files = archive.files;
    if (this.root.internal_type !== 'RootLayerModule') throw new EditError('preset_root must be a RootLayerModule');
  }

  static fromBytes(bytes: Uint8Array): KlwpDocument {
    return new KlwpDocument(readKlwp(bytes));
  }

  static create(info: Partial<PresetInfo> = {}): KlwpDocument {
    const root: ModuleJson = {
      internal_type: 'RootLayerModule',
      background_type: 'SOLID',
      background_color: '#FF000000',
      viewgroup_items: [],
    };
    return new KlwpDocument({ info: { ...DEFAULT_INFO, ...info }, root, files: new Map() });
  }

  // --- Tree navigation -----------------------------------------------------

  static children(m: ModuleJson): ModuleJson[] {
    return Array.isArray(m.viewgroup_items) ? (m.viewgroup_items as ModuleJson[]) : [];
  }

  /** Visits every module with its path ("/" for the root, "/0/2" for nested children). */
  walk(fn: (m: ModuleJson, path: string, parent: ModuleJson | null) => void) {
    const rec = (m: ModuleJson, path: string, parent: ModuleJson | null) => {
      fn(m, path, parent);
      KlwpDocument.children(m).forEach((c, i) => rec(c, path === '/' ? `/${i}` : `${path}/${i}`, m));
    };
    rec(this.root, '/', null);
  }

  pathOf(target: ModuleJson): string | null {
    let found: string | null = null;
    this.walk((m, path) => {
      if (m === target) found = path;
    });
    return found;
  }

  parentOf(target: ModuleJson): ModuleJson | null {
    let found: ModuleJson | null = null;
    this.walk((m, _p, parent) => {
      if (m === target) found = parent;
    });
    return found;
  }

  /**
   * Resolves a module reference: a path ("/", "/0/1"), a title ("#Clock", exact internal_title,
   * must be unique) or an alias from the current batch ("@clock").
   */
  resolve(ref: string, aliases: Map<string, ModuleJson> = new Map()): ModuleJson {
    const r = ref.trim();
    if (r.startsWith('@')) {
      const m = aliases.get(r.slice(1));
      if (!m) throw new EditError(`Unknown alias ${r}`);
      return m;
    }
    if (r.startsWith('#')) {
      const title = r.slice(1);
      const hits: ModuleJson[] = [];
      this.walk((m) => {
        if (m.internal_title === title) hits.push(m);
      });
      if (hits.length !== 1) throw new EditError(hits.length ? `Title "${title}" is not unique (${hits.length} modules); use a path` : `No module titled "${title}"`);
      return hits[0];
    }
    if (!r.startsWith('/')) throw new EditError(`Bad module reference "${ref}": use /path, #Title or @alias`);
    let m = this.root;
    for (const part of r.split('/').filter(Boolean)) {
      const kids = KlwpDocument.children(m);
      const i = Number(part);
      if (!Number.isInteger(i) || !kids[i]) throw new EditError(`No module at ${ref}`);
      m = kids[i];
    }
    return m;
  }

  // --- Module edits --------------------------------------------------------

  /** Builds a module (and its children) from a spec and inserts it under `parent`. */
  addModule(parent: ModuleJson, spec: ModuleSpec, index?: number, aliases?: Map<string, ModuleJson>): ModuleJson {
    if (!isLayerType(String(parent.internal_type))) throw new EditError(`Cannot add children to a ${parent.internal_type}; parent must be a layer`);
    const m = this.buildModule(spec, aliases);
    if (!Array.isArray(parent.viewgroup_items)) parent.viewgroup_items = [];
    const list = parent.viewgroup_items as ModuleJson[];
    const at = index === undefined || index < 0 || index > list.length ? list.length : index;
    list.splice(at, 0, m);
    return m;
  }

  private buildModule(spec: ModuleSpec, aliases?: Map<string, ModuleJson>): ModuleJson {
    if (!spec || typeof spec.type !== 'string') throw new EditError('Module spec needs a "type"');
    if (!isModuleType(spec.type) || spec.type === 'RootLayerModule') {
      throw new EditError(`Unknown module type "${spec.type}". Use one of ${MODULE_TYPES.filter((t) => t !== 'RootLayerModule').join(', ')}`);
    }
    const m: ModuleJson = { internal_type: spec.type };
    if (spec.title) m.internal_title = spec.title;
    for (const [k, v] of Object.entries(spec.props ?? {})) this.setProp(m, k, v);
    if (spec.animations) this.setAnimations(m, spec.animations);
    if (spec.events) this.setEvents(m, spec.events);
    if (spec.children?.length) {
      if (!isLayerType(spec.type)) throw new EditError(`${spec.type} cannot have children`);
      m.viewgroup_items = spec.children.map((c) => this.buildModule(c, aliases));
    } else if (isLayerType(spec.type)) {
      m.viewgroup_items = [];
    }
    if (spec.as) aliases?.set(spec.as, m);
    return m;
  }

  removeModule(m: ModuleJson) {
    const parent = this.parentOf(m);
    if (!parent) throw new EditError('The root cannot be removed');
    const list = KlwpDocument.children(parent);
    list.splice(list.indexOf(m), 1);
  }

  /** Moves a module to a new parent (or position within the same parent). */
  moveModule(m: ModuleJson, newParent: ModuleJson, index?: number) {
    if (m === this.root) throw new EditError('The root cannot be moved');
    if (!isLayerType(String(newParent.internal_type))) throw new EditError('Target parent must be a layer');
    let p: ModuleJson | null = newParent;
    while (p) {
      if (p === m) throw new EditError('Cannot move a module inside itself');
      p = this.parentOf(p);
    }
    this.removeModule(m);
    if (!Array.isArray(newParent.viewgroup_items)) newParent.viewgroup_items = [];
    const list = newParent.viewgroup_items as ModuleJson[];
    const at = index === undefined || index < 0 || index > list.length ? list.length : index;
    list.splice(at, 0, m);
  }

  duplicate(m: ModuleJson): ModuleJson {
    const parent = this.parentOf(m);
    if (!parent) throw new EditError('The root cannot be duplicated');
    const copy = JSON.parse(JSON.stringify(m)) as ModuleJson;
    const list = KlwpDocument.children(parent);
    list.splice(list.indexOf(m) + 1, 0, copy);
    return copy;
  }

  setTitle(m: ModuleJson, title: string | null) {
    if (title) m.internal_title = title;
    else delete m.internal_title;
  }

  /**
   * Sets a property. Literal values clear any formula/global on that key (toggle flags as in
   * RenderModule: 10 = formula, 100 = global). null resets the property to its default.
   */
  setProp(m: ModuleJson, key: string, value: PropValue, opts: { raw?: boolean } = {}) {
    const type = String(m.internal_type);
    const def = propDef(type, key);
    if (!def && !opts.raw) {
      const known = moduleProps(type).map((d) => d.key);
      const near = known.filter((k) => k.includes(key.replace(/^\w+?_/, '')) || key.includes(k.replace(/^\w+?_/, '')));
      throw new EditError(`${type} has no property "${key}"${near.length ? ` (did you mean ${near.slice(0, 3).join(', ')}?)` : ''}`);
    }
    const toggles = sub(m, 'internal_toggles');
    const formulas = sub(m, 'internal_formulas');
    const globals = sub(m, 'internal_globals');
    const clear = () => {
      delete toggles[key];
      delete formulas[key];
      delete globals[key];
    };
    if (value === null) {
      clear();
      delete m[key];
    } else if (typeof value === 'object') {
      if ('formula' in value) {
        if (typeof value.formula !== 'string') throw new EditError(`${key}: formula must be a string`);
        clear();
        toggles[key] = 10;
        formulas[key] = value.formula;
      } else if ('global' in value) {
        const name = String(value.global);
        if (!this.globals()[name]) throw new EditError(`${key}: no global named "${name}" (create it first with a "global" op)`);
        clear();
        toggles[key] = 100;
        globals[key] = name;
      } else {
        throw new EditError(`${key}: object values must be {"formula": "..."} or {"global": "name"}`);
      }
    } else {
      let v: string | number = value;
      if (def && !opts.raw) {
        if (def.type === 'enum' && typeof v === 'string') v = v.trim().toUpperCase();
        if (def.type === 'color' && typeof v === 'string') v = v.trim().toUpperCase();
        if (def.type === 'color' && typeof v === 'string' && /^#[0-9A-F]{6}$/.test(v)) v = '#FF' + v.slice(1);
        if ((def.type === 'number' || def.type === 'percent' || def.type === 'angle') && typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) v = Number(v);
        const err = checkValue(def, v);
        if (err) throw new EditError(err);
      }
      clear();
      m[key] = v;
    }
    for (const k of ['internal_toggles', 'internal_formulas', 'internal_globals']) dropEmpty(m, k);
  }

  setAnimations(m: ModuleJson, anims: Record<string, unknown>[] | null) {
    if (!anims || anims.length === 0) {
      delete m.internal_animations;
      return;
    }
    for (const a of anims) {
      for (const [k, values] of [['type', ENUMS.animationType], ['action', ENUMS.animationAction], ['rule', ENUMS.animationRule], ['center', ENUMS.animationCenter]] as const) {
        if (a[k] !== undefined && !(values as readonly string[]).includes(String(a[k]))) {
          throw new EditError(`animation ${k} must be one of ${values.join(', ')}`);
        }
      }
      if (a.type === undefined) throw new EditError('animation needs a "type", e.g. SCROLL');
    }
    m.internal_animations = anims;
  }

  setEvents(m: ModuleJson, events: Record<string, unknown>[] | null) {
    if (!events || events.length === 0) {
      delete m.internal_events;
      return;
    }
    for (const e of events) {
      if (e.type !== undefined && !(ENUMS.touchType as readonly string[]).includes(String(e.type))) throw new EditError(`event type must be one of ${ENUMS.touchType.join(', ')}`);
      if (e.action !== undefined && !(ENUMS.touchAction as readonly string[]).includes(String(e.action))) throw new EditError(`event action must be one of ${ENUMS.touchAction.join(', ')}`);
      if (e.music_action !== undefined && !(ENUMS.musicAction as readonly string[]).includes(String(e.music_action))) throw new EditError(`music_action must be one of ${ENUMS.musicAction.join(', ')}`);
    }
    m.internal_events = events;
  }

  // --- Globals -------------------------------------------------------------

  globals(): Record<string, GlobalJson> {
    return sub(this.root, 'globals_list') as Record<string, GlobalJson>;
  }

  setGlobal(name: string, spec: GlobalSpec) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new EditError(`Global name "${name}" must be letters, digits, - or _`);
    const type = String(spec.type ?? '').toUpperCase();
    if (!(ENUMS.globalType as readonly string[]).includes(type)) throw new EditError(`Global type must be one of ${ENUMS.globalType.join(', ')}`);
    if (type === 'COLOR' && spec.value !== undefined && !COLOR_RE.test(String(spec.value))) throw new EditError(`Global ${name}: value must be a colour like #FFRRGGBB`);
    const all = this.globals();
    const prev = all[name];
    const index = prev?.index ?? Math.max(0, ...Object.values(all).map((g) => Number(g.index) || 0)) + 1;
    const g: GlobalJson = { index, type, title: spec.title ?? prev?.title ?? name };
    if (spec.description) g.description = spec.description;
    g.value = spec.value ?? prev?.value ?? (type === 'COLOR' ? '#FFFFFFFF' : type === 'NUMBER' || type === 'SWITCH' ? 0 : '');
    // An omitted formula keeps the previous one; "" removes it.
    const formula = spec.formula ?? prev?.global_formula;
    if (formula) {
      g.toggles = 10;
      g.global_formula = formula;
    }
    all[name] = g;
  }

  removeGlobal(name: string) {
    const all = this.globals();
    if (!all[name]) throw new EditError(`No global named "${name}"`);
    delete all[name];
    dropEmpty(this.root, 'globals_list');
  }

  // --- Assets --------------------------------------------------------------

  /**
   * Adds a font, image or icon font to the archive and returns its kfile:// URI.
   * Icon fonts need their IcoMoon selection JSON (`iconJson`) for icon names.
   */
  addAsset(bytes: Uint8Array, filename: string, opts: { kind?: 'font' | 'bitmap' | 'icons'; iconJson?: Uint8Array } = {}): string {
    const ext = (/\.(\w+)$/.exec(filename)?.[1] ?? '').toLowerCase();
    const base = filename.split(/[\\/]/).pop()!.replace(/[^\w .()-]/g, '_');
    const kind = opts.kind ?? (opts.iconJson ? 'icons' : ['ttf', 'otf'].includes(ext) ? 'font' : 'bitmap');
    let path: string;
    if (kind === 'icons') {
      if (!opts.iconJson) throw new EditError('Icon sets need the IcoMoon .json that lists icon names');
      if (parseIconNames(opts.iconJson).size === 0) throw new EditError(`${filename}: the .json lists no icons`);
      path = `icons/${base.replace(/\.\w+$/, '')}.ttf`;
      this.files.set(path.replace(/\.ttf$/, '.json'), opts.iconJson);
    } else if (kind === 'font') {
      if (!['ttf', 'otf'].includes(ext)) throw new EditError(`${filename}: fonts must be .ttf or .otf`);
      path = `fonts/${base}`;
    } else {
      const head = new TextDecoder().decode(bytes.subarray(0, 1024));
      const svg = /<svg[\s>]/i.test(head);
      const raster = /^(\x89PNG|\xFF\xD8\xFF|GIF8|RIFF)/.test(String.fromCharCode(...bytes.subarray(0, 4)));
      if (!svg && !raster) throw new EditError(`${filename}: not a PNG, JPEG, GIF, WebP or SVG image`);
      path = `bitmaps/${svg ? 'SVG' : 'IMG'}${hash128(bytes)}`;
    }
    this.files.set(path, bytes);
    return KFILE_PREFIX + path;
  }

  /** Archive paths referenced anywhere in the preset (property values, formulas, globals). */
  referencedFiles(): Set<string> {
    const refs = new Set<string>();
    const scan = (v: unknown) => {
      if (typeof v === 'string') {
        for (const m of v.matchAll(/kfile:\/\/[^/\s"']+\/([^"'$,)]+)/g)) refs.add(kfilePath(m[0]) ?? m[1]);
      } else if (v && typeof v === 'object') {
        Object.values(v).forEach(scan);
      }
    };
    scan(this.root);
    for (const r of [...refs]) if (r.startsWith('icons/')) refs.add(r.replace(/\.\w+$/, '.json'));
    return refs;
  }

  // --- Validation ----------------------------------------------------------

  validate(): Issue[] {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], path: string, message: string) => issues.push({ level, path, message });
    const globals = this.globals();
    const fctx: FormulaContext = {
      functions: createFunctions({ state: defaultDeviceState(), global: () => '' }),
    };
    const checkFormula = (path: string, key: string, f: string) => {
      for (const seg of splitSegments(f)) {
        if (!seg.expr) continue;
        const warnings: string[] = [];
        evaluateText(`$${seg.s}$`, { ...fctx, warn: (w) => warnings.push(w) });
        for (const w of warnings) add('error', path, `${key}: ${w}`);
        for (const g of seg.s.matchAll(/gv\(\s*([\w-]+)/gi)) if (!globals[g[1]]) add('error', path, `${key}: gv(${g[1]}) refers to a missing global`);
      }
    };
    const checkUri = (path: string, key: string, uri: string) => {
      const file = kfilePath(uri);
      if (!file) add('error', path, `${key}: "${uri}" is not a kfile:// URI`);
      else if (!this.files.has(file)) add('error', path, `${key}: ${file} is not in the archive`);
    };

    this.walk((m, path, parent) => {
      const type = String(m.internal_type);
      if (!isModuleType(type)) {
        add('warning', path, `${type} is not editable or previewed by this tool`);
        return;
      }
      if (type === 'RootLayerModule' && parent) add('error', path, 'RootLayerModule can only be the root');
      if (!isLayerType(type) && Array.isArray(m.viewgroup_items) && m.viewgroup_items.length) add('error', path, `${type} cannot have children`);
      const toggles = (m.internal_toggles ?? {}) as Record<string, number>;
      const formulas = (m.internal_formulas ?? {}) as Record<string, string>;
      const gbind = (m.internal_globals ?? {}) as Record<string, string>;
      for (const [key, value] of Object.entries(m)) {
        if (key.startsWith('internal_') || key === 'viewgroup_items' || key === 'globals_list') continue;
        const def = propDef(type, key);
        if (!def) {
          add('warning', path, `unknown property ${key}`);
          continue;
        }
        const err = checkValue(def, value);
        if (err) add('error', path, err);
        if (def.type === 'formula' && typeof value === 'string') checkFormula(path, key, value);
        if (['font', 'iconset'].includes(def.type) && value) checkUri(path, key, String(value));
        if (def.type === 'bitmap' && typeof value === 'string' && value && !value.includes('$')) checkUri(path, key, value);
      }
      for (const [key, t] of Object.entries(toggles)) {
        if ((t & 100) === 100) {
          if (!globals[gbind[key]]) add('error', path, `${key} is bound to missing global "${gbind[key]}"`);
        } else if ((t & 10) === 10) {
          if (typeof formulas[key] !== 'string') add('error', path, `${key} has the formula flag but no formula`);
          else checkFormula(path, key, formulas[key]);
        }
      }
      if (type === 'FontIconModule') {
        const set = kfilePath(String(m.icon_set ?? ''));
        const json = set ? this.files.get(set.replace(/\.\w+$/, '.json')) : undefined;
        if (!m.icon_set) add('warning', path, 'icon_set is empty: the app falls back to its built-in material set, which the preview cannot show');
        const name = typeof m.icon_icon === 'string' ? m.icon_icon : 'star';
        const formulaIcon = (toggles.icon_icon ?? 0) & 10;
        if (json && !formulaIcon && !parseIconNames(json).has(name.toLowerCase())) add('error', path, `icon "${name}" is not in ${set}`);
      }
    });
    const refs = this.referencedFiles();
    for (const path of this.files.keys()) {
      if (/^(fonts|bitmaps|icons)\//.test(path) && !refs.has(path)) add('warning', '/', `${path} is not used by any module (dropped on export with --prune)`);
    }
    for (const [name, g] of Object.entries(globals)) {
      if (!(ENUMS.globalType as readonly string[]).includes(String(g.type))) add('warning', '/', `global ${name}: type ${g.type} is not previewed`);
      if (g.global_formula) checkFormula('/', `global ${name}`, g.global_formula);
    }
    return issues;
  }

  // --- Export --------------------------------------------------------------

  /** Detects provider features the app lists in preset_info.features. */
  features(): string {
    const text = JSON.stringify(this.root);
    const set = new Set(String(this.info.features ?? '').split(/\s+/).filter(Boolean));
    if (/\bw[if]\(/.test(text)) set.add('WEATHER');
    if (/\bmi\(/.test(text)) set.add('MUSIC');
    return [...set].join(' ');
  }

  /**
   * Serialises to .klwp bytes. Unreferenced assets are dropped unless `keepUnused`;
   * thumbnails (JPEG) are optional but the app shows them in its preset list.
   */
  toBytes(opts: { keepUnused?: boolean; thumbs?: { portrait?: Uint8Array; landscape?: Uint8Array } } = {}): Uint8Array {
    const refs = this.referencedFiles();
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of this.files) {
      if (path === 'preset.json' || path.startsWith('preset_thumb_')) continue;
      if (opts.keepUnused || refs.has(path)) files.set(path, bytes);
    }
    if (opts.thumbs?.portrait) files.set('preset_thumb_portrait.jpg', opts.thumbs.portrait);
    if (opts.thumbs?.landscape) files.set('preset_thumb_landscape.jpg', opts.thumbs.landscape);
    const info = { ...this.info, features: this.features() };
    return writeKlwp(info, this.root, files);
  }

  /** Full JSON snapshot for undo/redo (assets are append-only, so they are not included). */
  snapshot(): string {
    return JSON.stringify({ info: this.info, root: this.root });
  }

  restore(snap: string) {
    const s = JSON.parse(snap) as { info: PresetInfo; root: ModuleJson };
    this.info = s.info;
    this.root = s.root;
  }
}
