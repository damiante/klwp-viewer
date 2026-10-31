import type { ModuleJson } from './klwp/archive';
import { EditError, KlwpDocument } from './klwp/document';
import { type DeviceState, defaultDeviceState } from './klwp/functions';
import { type ModuleBox, KlwpRenderer } from './klwp/render';
import { Resources } from './klwp/resources';
import { isLayerType } from './klwp/schema';
import { browserPlatform } from './platform-browser';
import { renderInspector } from './ui/inspector';
import { renderTree } from './ui/tree';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('screen');
const ctx = canvas.getContext('2d')!;
const offsetInput = $<HTMLInputElement>('offset');
const screensInput = $<HTMLInputElement>('screens');
const darkInput = $<HTMLInputElement>('dark');
const playingInput = $<HTMLInputElement>('playing');
const batteryInput = $<HTMLInputElement>('battery');
const timeInput = $<HTMLInputElement>('time');
const hint = $('hint');

/** Editor state shared with the tree and inspector panels. */
export class App {
  doc: KlwpDocument | null = null;
  resources: Resources | null = null;
  renderer: KlwpRenderer | null = null;
  selected: ModuleJson | null = null;
  boxes: ModuleBox[] = [];
  readonly state: DeviceState = defaultDeviceState();
  fixedTime: Date | null = null;
  offset = 0.5;
  screens = 3;
  fileName = 'preset.klwp';
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  async open(doc: KlwpDocument, name: string) {
    this.doc = doc;
    this.fileName = name.replace(/^.*\//, '');
    this.resources = await Resources.load(doc.files, browserPlatform);
    this.undoStack = [];
    this.redoStack = [];
    this.selected = doc.root;
    const { width, height } = doc.info;
    const clamp = (v: number) => Math.min(2000, Math.max(100, Number(v) || 540));
    // Preset sizes are half the device pixel size (e.g. 540x1200 for a 1080x2400 phone).
    canvas.width = clamp(width) * 2;
    canvas.height = clamp(height) * 2;
    this.rebuild();
    this.screens = Math.max(1, Math.min(9, Math.max(Number(doc.info.xscreens) || 3, this.renderer!.referencedScreens)));
    screensInput.value = String(this.screens);
    this.setOffset(this.screens > 1 ? Math.ceil((this.screens - 1) / 2) / (this.screens - 1) : 0);
    hint.textContent = 'Click a module to select it. Drag sideways to swipe between home screens.';
    $<HTMLButtonElement>('export').disabled = false;
    this.refresh();
  }

  /** Runs an edit with undo support; EditErrors are shown instead of thrown. */
  edit(fn: (doc: KlwpDocument) => void): boolean {
    if (!this.doc) return false;
    const before = this.doc.snapshot();
    const path = this.selected ? this.doc.pathOf(this.selected) : null;
    try {
      fn(this.doc);
    } catch (e) {
      this.doc.restore(before);
      this.reselect(path);
      toast(e instanceof EditError ? e.message : `Error: ${(e as Error).message}`);
      this.refresh();
      return false;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.refresh();
    return true;
  }

  undo(redo = false) {
    if (!this.doc) return;
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const snap = from.pop();
    if (!snap) return;
    const path = this.selected ? this.doc.pathOf(this.selected) : null;
    to.push(this.doc.snapshot());
    this.doc.restore(snap);
    this.reselect(path);
    this.refresh();
  }

  /** Re-selects by path after the tree objects were replaced (undo/restore). */
  private reselect(path: string | null) {
    if (!this.doc) return;
    try {
      this.selected = path ? this.doc.resolve(path) : this.doc.root;
    } catch {
      this.selected = this.doc.root;
    }
  }

  select(m: ModuleJson | null) {
    this.selected = m;
    this.refresh();
  }

  /** Adds uploaded files to the archive. Icon sets need a .ttf and its .json together. */
  async addAssets(files: FileList | File[], kind?: 'font' | 'bitmap' | 'icons'): Promise<string | null> {
    if (!this.doc || !this.resources) return null;
    const list = [...files];
    const read = async (f: File) => new Uint8Array(await f.arrayBuffer());
    let uri: string | null = null;
    const known = new Set(this.doc.files.keys());
    try {
      if (kind === 'icons') {
        const ttf = list.find((f) => /\.(ttf|otf)$/i.test(f.name));
        const json = list.find((f) => /\.json$/i.test(f.name));
        if (!ttf || !json) throw new EditError('Choose the icon font (.ttf) and its IcoMoon selection .json together');
        uri = this.doc.addAsset(await read(ttf), ttf.name, { kind: 'icons', iconJson: await read(json) });
      } else {
        for (const f of list) uri = this.doc.addAsset(await read(f), f.name, { kind });
      }
    } catch (e) {
      toast((e as Error).message);
      return null;
    }
    for (const [path, bytes] of this.doc.files) {
      if (!known.has(path)) await this.resources.addFile(path, bytes, this.doc.files);
    }
    return uri;
  }

  rebuild() {
    if (this.doc && this.resources) this.renderer = new KlwpRenderer(this.doc, this.resources, this.state);
  }

  refresh() {
    this.rebuild();
    this.render();
    if (this.doc) {
      $('title').textContent = this.doc.info.title || this.fileName;
      renderTree($('tree'), this);
      renderInspector($('inspector'), this);
    }
    $<HTMLButtonElement>('undo').disabled = this.undoStack.length === 0;
    $<HTMLButtonElement>('redo').disabled = this.redoStack.length === 0;
  }

  render() {
    if (!this.renderer) return;
    syncState(this);
    const boxes: ModuleBox[] = [];
    this.renderer.render(ctx, { offset: this.offset, screens: this.screens }, (b) => boxes.push(b));
    this.boxes = boxes;
    const sel = boxes.find((b) => b.json === this.selected);
    if (sel) {
      ctx.save();
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.strokeStyle = '#3d5afe';
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    }
  }

  setOffset(v: number) {
    this.offset = Math.min(1, Math.max(0, v));
    offsetInput.value = String(this.offset);
  }

  async exportFile() {
    if (!this.doc) return;
    const errors = this.doc.validate().filter((i) => i.level === 'error');
    if (errors.length) toast(`Exported with ${errors.length} problem(s), e.g. ${errors[0].path} ${errors[0].message}`, 6000);
    const bytes = this.doc.toBytes({ thumbs: { portrait: await this.thumb(false), landscape: await this.thumb(true) } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    a.download = (this.doc.info.title || 'preset').replace(/[^\w.-]+/g, '_') + '.klwp';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async thumb(landscape: boolean): Promise<Uint8Array> {
    const c = document.createElement('canvas');
    c.width = landscape ? canvas.height : canvas.width;
    c.height = landscape ? canvas.width : canvas.height;
    this.renderer!.render(c.getContext('2d')!, { offset: this.offset, screens: this.screens });
    const t = document.createElement('canvas');
    t.width = Math.round(c.width / 2.35);
    t.height = Math.round(c.height / 2.35);
    t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
    const blob = await new Promise<Blob>((r) => t.toBlob((b) => r(b!), 'image/jpeg', 0.85));
    return new Uint8Array(await blob.arrayBuffer());
  }
}

function syncState(app: App) {
  const now = app.fixedTime ?? new Date();
  const s = app.state;
  s.now = now;
  s.sunrise = new Date(now);
  s.sunrise.setHours(6, 42, 0, 0);
  s.sunset = new Date(now);
  s.sunset.setHours(19, 18, 0, 0);
  s.darkMode = darkInput.checked;
  s.music.state = playingInput.checked ? 'PLAYING' : 'PAUSED';
  s.battery.level = Number(batteryInput.value);
}

let toastTimer = 0;
export function toast(msg: string, ms = 4000) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

const app = new App();
// Exposed for browser automation (e.g. agents driving the editor through DevTools).
(window as unknown as { klwpApp: App }).klwpApp = app;

async function openBytes(data: Uint8Array, name: string) {
  try {
    await app.open(KlwpDocument.fromBytes(data), name);
  } catch (e) {
    hint.textContent = `Could not open ${name}: ${(e as Error).message}`;
  }
}

// --- Canvas: click to select, drag to swipe ---------------------------------
let drag: { x: number; y: number; start: number; moved: boolean } | null = null;
let anim = 0;

canvas.addEventListener('pointerdown', (e) => {
  cancelAnimationFrame(anim);
  drag = { x: e.clientX, y: e.clientY, start: app.offset, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 4) drag.moved = true;
  if (!drag.moved || app.screens < 2) return;
  app.setOffset(drag.start - dx / canvas.clientWidth / (app.screens - 1));
  app.render();
});
const endDrag = (e: PointerEvent) => {
  if (!drag) return;
  const wasClick = !drag.moved;
  drag = null;
  if (wasClick) {
    pick(e);
    return;
  }
  if (app.screens < 2) return;
  const target = Math.round(app.offset * (app.screens - 1)) / (app.screens - 1);
  const from = app.offset;
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 220);
    app.setOffset(from + (target - from) * (1 - Math.pow(1 - k, 3)));
    app.render();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => (drag = null));

/** Selects the smallest module under the pointer; clicking again cycles to larger ones. */
function pick(e: PointerEvent) {
  if (!app.doc) return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvas.width;
  const y = ((e.clientY - r.top) / r.height) * canvas.height;
  const hits = app.boxes
    .filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    .sort((a, b) => a.w * a.h - b.w * b.h || (isLayerType(String(a.json.internal_type)) ? 1 : -1));
  if (!hits.length) return app.select(app.doc.root);
  const i = hits.findIndex((h) => h.json === app.selected);
  app.select(hits[i >= 0 && i + 1 < hits.length ? i + 1 : 0].json);
}

// --- Controls ----------------------------------------------------------------
offsetInput.addEventListener('input', () => {
  app.setOffset(Number(offsetInput.value));
  app.render();
});
screensInput.addEventListener('change', () => {
  app.screens = Math.max(1, Math.min(9, Number(screensInput.value) || 1));
  app.render();
});
for (const el of [darkInput, playingInput, batteryInput]) el.addEventListener('input', () => app.render());
timeInput.addEventListener('change', () => {
  app.fixedTime = timeInput.value ? new Date(timeInput.value) : null;
  app.render();
});
$('now').addEventListener('click', () => {
  app.fixedTime = null;
  timeInput.value = '';
  app.render();
});
darkInput.checked = matchMedia('(prefers-color-scheme: dark)').matches;

$('new').addEventListener('click', () => {
  if (app.doc && !confirm('Discard the current preset and start a new one?')) return;
  void app.open(KlwpDocument.create({ title: 'my-wallpaper' }), 'my-wallpaper.klwp');
});
$('undo').addEventListener('click', () => app.undo());
$('redo').addEventListener('click', () => app.undo(true));
$('export').addEventListener('click', () => void app.exportFile());
document.addEventListener('keydown', (e) => {
  const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault();
    app.undo(e.shiftKey);
  }
});

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) await openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
});

$<HTMLSelectElement>('samples').addEventListener('change', async (e) => {
  const url = (e.target as HTMLSelectElement).value;
  if (!url) return;
  const resp = await fetch(url);
  await openBytes(new Uint8Array(await resp.arrayBuffer()), url);
});

const stage = $('stage');
stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('dropping');
});
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  stage.classList.remove('dropping');
  const f = e.dataTransfer?.files[0];
  if (f) await openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
});

// Keep clocks ticking; presets with loop animations redraw at ~30 fps.
let lastTick = 0;
const tick = (t: number) => {
  if (!drag && t - lastTick >= (app.renderer?.animated ? 33 : 1000)) {
    lastTick = t;
    app.render();
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

// Deep link: ?preset=samples/art_deco.klwp
const initial = new URLSearchParams(location.search).get('preset');
if (initial && /^samples\/[\w.-]+\.klwp$/.test(initial)) {
  fetch(initial)
    .then((r) => r.arrayBuffer())
    .then((b) => openBytes(new Uint8Array(b), initial));
}
