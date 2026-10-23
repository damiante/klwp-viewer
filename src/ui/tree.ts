import type { ModuleJson } from '../klwp/archive';
import { EditError, KlwpDocument } from '../klwp/document';
import { isLayerType } from '../klwp/schema';
import type { App } from '../main';

const SHORT: Record<string, string> = {
  RootLayerModule: 'Root',
  StackLayerModule: 'Stack',
  OverlapLayerModule: 'Overlap',
  TextModule: 'Text',
  ShapeModule: 'Shape',
  BitmapModule: 'Image',
  FontIconModule: 'Icon',
};

function label(m: ModuleJson): string {
  if (typeof m.internal_title === 'string' && m.internal_title) return m.internal_title;
  const formula = (k: string) => ((m.internal_formulas ?? {}) as Record<string, string>)[k];
  switch (m.internal_type) {
    case 'TextModule':
      return String(m.text_expression ?? '$df(hh:mm)$');
    case 'FontIconModule':
      return formula('icon_icon') ?? String(m.icon_icon ?? 'star');
    case 'ShapeModule':
      return String(m.shape_type ?? 'SQUARE').toLowerCase();
    case 'BitmapModule': {
      const uri = String(m.bitmap_svg || m.bitmap_bitmap || formula('bitmap_bitmap') || '');
      return uri.split('/').pop() || 'image';
    }
  }
  return '';
}

let wired = false;

export function renderTree(root: HTMLElement, app: App) {
  const doc = app.doc!;
  if (!wired) wireToolbar(app);
  wired = true;
  const build = (m: ModuleJson, path: string): HTMLLIElement => {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row' + (m === app.selected ? ' selected' : '');
    if (m === app.selected) li.setAttribute('aria-selected', 'true');
    const type = String(m.internal_type);
    const tag = Object.assign(document.createElement('span'), { className: 'tag', textContent: SHORT[type] ?? type });
    const text = Object.assign(document.createElement('span'), { className: 'label', textContent: label(m) });
    row.append(tag, text);
    row.title = path;
    row.addEventListener('click', () => app.select(m));
    li.append(row);
    const kids = KlwpDocument.children(m);
    if (kids.length) {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      kids.forEach((c, i) => ul.append(build(c, path === '/' ? `/${i}` : `${path}/${i}`)));
      li.append(ul);
    }
    return li;
  };
  root.replaceChildren(build(doc.root, '/'));
  root.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function wireToolbar(app: App) {
  const addSelect = document.getElementById('add-type') as HTMLSelectElement;
  addSelect.addEventListener('change', () => {
    const type = addSelect.value;
    addSelect.value = '';
    if (!type || !app.doc) return;
    let added: ModuleJson | null = null;
    app.edit((doc) => {
      // Insert into the selected layer, or after the selected module.
      const sel = app.selected ?? doc.root;
      if (isLayerType(String(sel.internal_type))) {
        added = doc.addModule(sel, { type });
      } else {
        const parent = doc.parentOf(sel)!;
        added = doc.addModule(parent, { type }, KlwpDocument.children(parent).indexOf(sel) + 1);
      }
    });
    if (added) app.select(added);
  });

  document.getElementById('tree-tools')!.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    const m = app.selected;
    if (!act || !app.doc || !m) return;
    app.edit((doc) => {
      const parent = doc.parentOf(m);
      if (!parent) throw new EditError('The root cannot be moved, duplicated or deleted');
      const siblings = KlwpDocument.children(parent);
      const i = siblings.indexOf(m);
      switch (act) {
        case 'duplicate':
          app.selected = doc.duplicate(m);
          break;
        case 'delete':
          doc.removeModule(m);
          app.selected = siblings[Math.min(i, siblings.length - 1)] ?? parent;
          break;
        case 'up':
          if (i > 0) doc.moveModule(m, parent, i - 1);
          break;
        case 'down':
          if (i < siblings.length - 1) doc.moveModule(m, parent, i + 1);
          break;
        case 'out': {
          const grand = doc.parentOf(parent);
          if (grand) doc.moveModule(m, grand, KlwpDocument.children(grand).indexOf(parent) + 1);
          break;
        }
        case 'in': {
          const prev = siblings[i - 1];
          if (prev && isLayerType(String(prev.internal_type))) doc.moveModule(m, prev);
          else throw new EditError('The module above must be a layer to move into it');
          break;
        }
      }
    });
  });
}
