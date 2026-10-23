import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ModuleJson, kfilePath, readKlwp } from '../src/klwp/archive';
import { defaultDeviceState } from '../src/klwp/functions';
import { KlwpRenderer } from '../src/klwp/render';
import type { Resources } from '../src/klwp/resources';

const load = (name: string) => readKlwp(new Uint8Array(readFileSync(`public/samples/${name}`)));

function walk(m: ModuleJson, fn: (m: ModuleJson) => void) {
  fn(m);
  for (const c of (m.viewgroup_items as ModuleJson[] | undefined) ?? []) walk(c, fn);
}

/** Resources stand-in: images are 2:1, every icon resolves, fonts fall back. */
function fakeResources(): Resources {
  const fake = {
    missing: new Set<string>(),
    font: () => 'sans-serif',
    image: (uri: string) => (uri ? { image: {} as CanvasImageSource, width: 200, height: 100 } : null),
    iconSet: () => ({ family: 'icons', codes: { get: () => 0xe000 } }),
  };
  return fake as unknown as Resources;
}

/** Records fillText calls with their absolute position; text is 0.5em wide per char. */
function stubContext(width: number, height: number) {
  const texts: { text: string; x: number; y: number }[] = [];
  let m = new DOMMatrixStub();
  const stack: DOMMatrixStub[] = [];
  let fontPx = 10;
  const ctx = {
    canvas: { width, height },
    set font(f: string) {
      fontPx = parseFloat(f);
    },
    get font() {
      return `${fontPx}px x`;
    },
    measureText: (t: string) => ({ width: t.length * fontPx * 0.5, fontBoundingBoxAscent: fontPx * 0.8, fontBoundingBoxDescent: fontPx * 0.2 }),
    save: () => stack.push(m.clone()),
    restore: () => (m = stack.pop() ?? new DOMMatrixStub()),
    setTransform: () => (m = new DOMMatrixStub()),
    getTransform: () => ({ a: m.a, b: m.b, c: m.c, d: m.d }),
    translate: (x: number, y: number) => m.translate(x, y),
    rotate: (r: number) => m.rotate(r),
    scale: () => {},
    fillText: (text: string, x: number, y: number) => texts.push({ text, ...m.apply(x, y) }),
    strokeText: (text: string, x: number, y: number) => texts.push({ text, ...m.apply(x, y) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createConicGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    fillRect: () => {},
    drawImage: () => {},
    fill: () => {},
    stroke: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  clone() {
    return Object.assign(new DOMMatrixStub(), this);
  }
  translate(x: number, y: number) {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
  }
  rotate(r: number) {
    const [cos, sin] = [Math.cos(r), Math.sin(r)];
    [this.a, this.b, this.c, this.d] = [this.a * cos + this.c * sin, this.b * cos + this.d * sin, this.c * cos - this.a * sin, this.d * cos - this.b * sin];
  }
  apply(x: number, y: number) {
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
  }
}

// Path2D only exists in browsers; shapes are drawn through it.
globalThis.Path2D ??= class { rect() {} roundRect() {} ellipse() {} moveTo() {} lineTo() {} closePath() {} arc() {} } as unknown as typeof Path2D;

describe.each(['art_deco.klwp'])('%s', (file) => {
  const archive = load(file);

  it('reads preset info and the module tree', () => {
    expect(archive.info.width).toBe(540);
    expect(archive.info.height).toBe(1200);
    expect(archive.root.internal_type).toBe('RootLayerModule');
  });

  it('only uses module types the renderer supports', () => {
    const types = new Set<string>();
    walk(archive.root, (m) => types.add(String(m.internal_type)));
    for (const t of types) {
      expect(['RootLayerModule', 'StackLayerModule', 'OverlapLayerModule', 'TextModule', 'ShapeModule', 'BitmapModule', 'FontIconModule']).toContain(t);
    }
  });

  it('ships every font and icon set it references', () => {
    walk(archive.root, (m) => {
      for (const key of ['text_family', 'icon_set']) {
        const uri = m[key];
        if (typeof uri === 'string') expect(archive.files.has(kfilePath(uri)!), uri).toBe(true);
      }
    });
  });

  it('renders every screen without errors', () => {
    const r = new KlwpRenderer(archive, fakeResources(), defaultDeviceState(new Date(2025, 9, 23, 17, 29)));
    for (const offset of [0, 0.5, 1]) {
      const { ctx, texts } = stubContext(1080, 2400);
      r.render(ctx, { offset, screens: 3 });
      expect(texts.length).toBeGreaterThan(0);
    }
    expect(r.warnings).toEqual([]);
  });
});

describe('layout', () => {
  const at = (offset: number) => {
    const r = new KlwpRenderer(load('art_deco.klwp'), fakeResources(), defaultDeviceState(new Date(2025, 9, 23, 17, 29)));
    const { ctx, texts } = stubContext(1080, 2400);
    r.render(ctx, { offset, screens: 3 });
    return texts;
  };

  it('places the art deco clock on the centre screen', () => {
    // 3 screens: the CENTER group rests on screen index ceil(2 / 2) = 1, i.e. offset 0.5.
    const clock = at(0.5).find((t) => t.text === '05:29')!;
    expect(clock).toBeDefined();
    expect(clock.x).toBeGreaterThan(0);
    expect(clock.x).toBeLessThan(540);
  });

  it('scrolls widgets exactly one screen width per page (speed 200 over 2 steps)', () => {
    const title = (offset: number) => at(offset).find((t) => t.text === 'Midnight City')!.x;
    expect(title(0.5) - title(1)).toBeCloseTo(1080, 5);
  });

  it('applies dark mode through the art deco background formula', () => {
    const state = defaultDeviceState();
    const r = new KlwpRenderer(load('art_deco.klwp'), fakeResources(), state);
    const fills: string[] = [];
    const { ctx } = stubContext(1080, 2400);
    Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => fills.push(v), get: () => '' });
    state.darkMode = true;
    r.render(ctx, { offset: 0.5, screens: 3 });
    expect(fills[0]).toBe('rgba(0, 0, 0, 1)');
  });
});
