import { KFILE_PREFIX, type ModuleJson, kfilePath } from '../klwp/archive';
import { EditError, type PropValue } from '../klwp/document';
import { parseIconNames } from '../klwp/resources';
import { ENUMS, type PropDef, SCHEMA, isModuleType, moduleDefault } from '../klwp/schema';
import { type App, toast } from '../main';

const openSections = new Set<string>(['text', 'shape', 'icon', 'bitmap', 'background', 'layer']);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

type Mode = 'value' | 'formula' | 'global';

function modeOf(m: ModuleJson, key: string): Mode {
  const t = Number(((m.internal_toggles ?? {}) as Record<string, number>)[key] ?? 0);
  if ((t & 100) === 100) return 'global';
  if ((t & 10) === 10) return 'formula';
  return 'value';
}

/** #AARRGGBB -> #RRGGBB for <input type=color>. */
const rgbOf = (c: string) => (/^#[0-9a-f]{8}$/i.test(c) ? '#' + c.slice(3) : /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff');

export function renderInspector(root: HTMLElement, app: App) {
  const doc = app.doc!;
  const m = app.selected ?? doc.root;
  const type = String(m.internal_type);
  const path = doc.pathOf(m) ?? '?';
  const onRoot = doc.parentOf(m) === doc.root;
  const set = (key: string, v: PropValue) => app.edit((d) => d.setProp(m, key, v));

  const parts: Node[] = [el('h2', { textContent: `${type.replace('Module', '')} ${path}` })];
  if (type !== 'RootLayerModule') {
    const title = el('input', { value: String(m.internal_title ?? ''), placeholder: 'Title (optional)' });
    title.addEventListener('change', () => app.edit((d) => d.setTitle(m, title.value.trim() || null)));
    parts.push(el('label', { className: 'stacked' }, 'Title', title));
  }
  if (!isModuleType(type)) {
    parts.push(el('p', { className: 'muted', textContent: `${type} modules are not editable here yet.` }));
    root.replaceChildren(...parts);
    return;
  }
  if (type === 'RootLayerModule') parts.push(presetSection(app), globalsSection(app));

  for (const section of SCHEMA[type].sections) {
    const details = el('details', { open: openSections.has(section.name) });
    details.addEventListener('toggle', () => (details.open ? openSections.add(section.name) : openSections.delete(section.name)));
    details.append(el('summary', { textContent: section.name }));
    for (const def of section.props) {
      if (def.key === 'position_offset_x' || def.key === 'position_offset_y') {
        if (!onRoot) continue; // offsets only apply to root children
      }
      if (def.key === 'position_anchor' && doc.parentOf(m)?.internal_type === 'StackLayerModule') continue;
      details.append(propRow(app, m, def, onRoot, set));
    }
    parts.push(details);
  }

  if (type !== 'RootLayerModule') parts.push(jsonSection(app, m, 'internal_animations', 'Animations', SCROLL_EXAMPLE), jsonSection(app, m, 'internal_events', 'Touch events', TAP_EXAMPLE));
  const raw = el('details', {}, el('summary', { textContent: 'JSON' }));
  const { viewgroup_items: _kids, ...own } = m;
  raw.append(el('pre', { className: 'json', textContent: JSON.stringify(own, null, 1) }));
  parts.push(raw);
  root.replaceChildren(...parts);
}

function propRow(app: App, m: ModuleJson, def: PropDef, onRoot: boolean, set: (k: string, v: PropValue) => void): HTMLElement {
  const doc = app.doc!;
  const key = def.key;
  const mode = modeOf(m, key);
  const value = m[key];
  const dflt = moduleDefault(String(m.internal_type), key, onRoot);
  const row = el('div', { className: 'prop' + (value !== undefined || mode !== 'value' ? ' set' : '') });
  const name = el('span', { className: 'name', textContent: key.replace(/^(position|config|paint|fx|text|shape|bitmap|icon|background)_/, ''), title: `${key}: ${def.desc}` });

  const modeSel = el('select', { className: 'mode', title: 'Value source' }, ...(['value', 'formula', 'global'] as Mode[]).map((v) => el('option', { value: v, textContent: v === 'value' ? '=' : v === 'formula' ? 'ƒ' : 'gv', selected: v === mode })));
  modeSel.addEventListener('change', () => {
    const next = modeSel.value as Mode;
    if (next === 'formula') set(key, { formula: String(((m.internal_formulas ?? {}) as Record<string, string>)[key] ?? (typeof value === 'string' ? value : '')) });
    else if (next === 'global') {
      const names = Object.keys(doc.globals());
      if (!names.length) {
        toast('Create a global first: select the root and use the Globals section');
        modeSel.value = mode;
        return;
      }
      set(key, { global: names[0] });
    } else set(key, (value as PropValue) ?? (dflt as PropValue));
  });

  let control: HTMLElement;
  if (mode === 'formula') {
    const ta = el('textarea', { rows: 2, value: String(((m.internal_formulas ?? {}) as Record<string, string>)[key] ?? ''), placeholder: '$formula$' });
    ta.addEventListener('change', () => set(key, { formula: ta.value }));
    control = ta;
  } else if (mode === 'global') {
    const cur = ((m.internal_globals ?? {}) as Record<string, string>)[key];
    const sel = el('select', {}, ...Object.keys(doc.globals()).map((g) => el('option', { value: g, textContent: g, selected: g === cur })));
    sel.addEventListener('change', () => set(key, { global: sel.value }));
    control = sel;
  } else {
    control = valueControl(app, m, def, value, dflt, (v) => set(key, v));
  }
  const reset = el('button', { type: 'button', className: 'reset', textContent: '×', title: 'Reset to default' });
  reset.disabled = value === undefined && mode === 'value';
  reset.addEventListener('click', () => set(key, null));
  row.append(name, modeSel, control, reset);
  return row;
}

function valueControl(app: App, m: ModuleJson, def: PropDef, value: unknown, dflt: unknown, commit: (v: PropValue) => void): HTMLElement {
  const doc = app.doc!;
  const shown = value ?? dflt;
  switch (def.type) {
    case 'number':
    case 'percent':
    case 'angle': {
      const inp = el('input', { type: 'number', step: 'any', value: value === undefined ? '' : String(value), placeholder: String(dflt ?? '') });
      if (def.type === 'percent') Object.assign(inp, { min: '0', max: '100' });
      inp.addEventListener('change', () => commit(inp.value === '' ? null : Number(inp.value)));
      return inp;
    }
    case 'enum': {
      const sel = el('select', {}, ...def.values!.map((v) => el('option', { value: v, textContent: v === dflt ? `${v} (default)` : v, selected: v === shown })));
      sel.addEventListener('change', () => commit(sel.value === dflt && value === undefined ? null : sel.value));
      return sel;
    }
    case 'color': {
      const text = el('input', { value: String(shown ?? ''), placeholder: '#AARRGGBB', size: 10 });
      const pick = el('input', { type: 'color', value: rgbOf(String(shown ?? '')), title: 'Pick colour (alpha kept from the text field)' });
      text.addEventListener('change', () => commit(text.value.trim() || null));
      pick.addEventListener('change', () => {
        const alpha = /^#[0-9a-f]{8}$/i.test(text.value) ? text.value.slice(1, 3) : 'FF';
        commit(`#${alpha}${pick.value.slice(1)}`.toUpperCase());
      });
      return el('span', { className: 'color' }, pick, text);
    }
    case 'formula': {
      const ta = el('textarea', { rows: def.key === 'text_expression' ? 3 : 2, value: String(shown ?? '') });
      ta.addEventListener('change', () => commit(ta.value));
      return ta;
    }
    case 'font':
    case 'bitmap':
    case 'iconset': {
      const prefix = def.type === 'font' ? 'fonts/' : def.type === 'bitmap' ? 'bitmaps/' : 'icons/';
      const files = [...doc.files.keys()].filter((k) => k.startsWith(prefix) && !(def.type === 'iconset' && !/\.(ttf|otf)$/i.test(k)));
      const cur = typeof value === 'string' ? kfilePath(value) : null;
      const sel = el('select', {},
        el('option', { value: '', textContent: def.type === 'font' ? '(default Roboto)' : '(none)' }),
        ...files.map((f) => el('option', { value: f, textContent: f.slice(prefix.length), selected: f === cur })),
        el('option', { value: '__upload', textContent: 'Upload…' }));
      if (cur && !files.includes(cur)) sel.append(el('option', { value: cur, textContent: `${cur} (missing)`, selected: true }));
      sel.addEventListener('change', () => {
        if (sel.value !== '__upload') return commit(sel.value ? KFILE_PREFIX + sel.value : null);
        const input = el('input', { type: 'file', multiple: def.type === 'iconset', accept: def.type === 'font' ? '.ttf,.otf' : def.type === 'iconset' ? '.ttf,.otf,.json' : 'image/*,.svg' });
        input.addEventListener('change', async () => {
          if (!input.files?.length) return;
          const kind = def.type === 'font' ? 'font' : def.type === 'iconset' ? 'icons' : 'bitmap';
          const uri = await app.addAssets(input.files, kind);
          if (uri) {
            commit(uri);
            if (def.key === 'bitmap_svg' || (def.key === 'bitmap_bitmap' && uri.includes('/SVG'))) app.edit((d) => d.setProp(m, 'bitmap_mode', uri.includes('/SVG') ? 'VECTOR' : 'BITMAP'));
          } else app.refresh();
        });
        input.click();
        sel.value = cur ?? '';
      });
      return sel;
    }
    case 'icon': {
      const setPath = kfilePath(String(m.icon_set ?? ''));
      const json = setPath ? doc.files.get(setPath.replace(/\.\w+$/, '.json')) : undefined;
      const listId = `icons-${setPath}`;
      const inp = el('input', { value: String(shown ?? ''), placeholder: 'icon name' });
      inp.setAttribute('list', listId);
      if (json && !document.getElementById(listId)) {
        const dl = el('datalist', { id: listId }, ...[...parseIconNames(json).keys()].sort().map((n) => el('option', { value: n })));
        document.body.append(dl);
      }
      inp.addEventListener('change', () => commit(inp.value.trim() || null));
      return inp;
    }
    default: {
      const inp = el('input', { value: String(shown ?? '') });
      inp.addEventListener('change', () => commit(inp.value));
      return inp;
    }
  }
}

const SCROLL_EXAMPLE = [{ type: 'SCROLL', center: 'CENTER', speed: 200 }];
const TAP_EXAMPLE = [{ type: 'SINGLE_TAP', action: 'MUSIC', music_action: 'PLAY_PAUSE' }];

function jsonSection(app: App, m: ModuleJson, key: 'internal_animations' | 'internal_events', title: string, example: unknown): HTMLElement {
  const cur = m[key];
  const details = el('details', { open: openSections.has(key) });
  details.addEventListener('toggle', () => (details.open ? openSections.add(key) : openSections.delete(key)));
  details.append(el('summary', { textContent: `${title}${Array.isArray(cur) && cur.length ? ` (${cur.length})` : ''}` }));
  const ta = el('textarea', { rows: 5, className: 'code', value: cur ? JSON.stringify(cur, null, 1) : '', placeholder: JSON.stringify(example) });
  const apply = el('button', { type: 'button', textContent: 'Apply' });
  apply.addEventListener('click', () => {
    let v: Record<string, unknown>[] | null;
    try {
      v = ta.value.trim() ? (JSON.parse(ta.value) as Record<string, unknown>[]) : null;
      if (v && !Array.isArray(v)) throw new Error('Expected a JSON array');
    } catch (e) {
      toast(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    app.edit((d) => (key === 'internal_animations' ? d.setAnimations(m, v) : d.setEvents(m, v)));
  });
  const hint =
    key === 'internal_animations'
      ? `type: ${ENUMS.animationType.slice(1, 3).join('/')}…, center: CENTER, SCREEN1…, CENTER_M1/P1…, speed: % (200 moves one screen per page with 3 screens)`
      : `type: ${ENUMS.touchType.join('/')}, action: ${ENUMS.touchAction.join('/')}`;
  details.append(ta, el('p', { className: 'muted small', textContent: hint }), apply);
  return details;
}

function presetSection(app: App): HTMLElement {
  const doc = app.doc!;
  const details = el('details', { open: openSections.has('preset') });
  details.addEventListener('toggle', () => (details.open ? openSections.add('preset') : openSections.delete('preset')));
  details.append(el('summary', { textContent: 'preset' }));
  const field = (key: 'title' | 'description' | 'width' | 'height' | 'xscreens', label: string, numeric = false) => {
    const inp = el('input', { value: String(doc.info[key] ?? ''), type: numeric ? 'number' : 'text' });
    inp.addEventListener('change', () =>
      app.edit((d) => {
        if (numeric && !(Number.isInteger(Number(inp.value)) && Number(inp.value) > 0)) throw new EditError(`${label} must be a positive whole number`);
        (d.info as unknown as Record<string, unknown>)[key] = numeric ? Number(inp.value) : inp.value;
      }),
    );
    return el('label', { className: 'stacked' }, label, inp);
  };
  details.append(field('title', 'Title'), field('description', 'Description'), field('width', 'Width (units, half the device px)', true), field('height', 'Height', true), field('xscreens', 'Home screens', true));
  return details;
}

function globalsSection(app: App): HTMLElement {
  const doc = app.doc!;
  const globals = doc.globals();
  const details = el('details', { open: openSections.has('globals') });
  details.addEventListener('toggle', () => (details.open ? openSections.add('globals') : openSections.delete('globals')));
  details.append(el('summary', { textContent: `globals (${Object.keys(globals).length})` }));
  for (const [name, g] of Object.entries(globals)) {
    const value = el('input', { value: String(g.value ?? ''), title: 'Value' });
    const formula = el('input', { value: g.global_formula ?? '', placeholder: 'formula (optional)' });
    const save = () =>
      app.edit((d) => {
        const numeric = g.type === 'NUMBER' || g.type === 'SWITCH';
        d.setGlobal(name, { type: g.type, value: numeric ? Number(value.value) : value.value, formula: formula.value });
      });
    value.addEventListener('change', save);
    formula.addEventListener('change', save);
    const del = el('button', { type: 'button', className: 'reset', textContent: '×', title: `Delete ${name}` });
    del.addEventListener('click', () => app.edit((d) => d.removeGlobal(name)));
    details.append(el('div', { className: 'global' }, el('span', { className: 'name', textContent: `${name} · ${g.type}` }), del, value, formula));
  }
  const name = el('input', { placeholder: 'new-global' });
  const type = el('select', {}, ...ENUMS.globalType.map((t) => el('option', { value: t, textContent: t })));
  const add = el('button', { type: 'button', textContent: 'Add global' });
  add.addEventListener('click', () => app.edit((d) => d.setGlobal(name.value.trim(), { type: type.value })));
  details.append(el('div', { className: 'global add' }, name, type, add));
  return details;
}
