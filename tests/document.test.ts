import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readKlwp } from '../src/klwp/archive';
import { KlwpDocument } from '../src/klwp/document';
import { applyOps, type Op } from '../src/klwp/ops';

const sample = (name: string) => new Uint8Array(readFileSync(`public/samples/${name}`));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('round trip', () => {
  it.each(['art_deco.klwp'])('%s survives load -> export -> load unchanged', (name) => {
    const original = readKlwp(sample(name));
    const doc = KlwpDocument.fromBytes(sample(name));
    const again = readKlwp(doc.toBytes({ keepUnused: true }));
    expect(again.root).toEqual(original.root);
    expect(again.info.title).toBe(original.info.title);
    for (const [path, bytes] of original.files) {
      if (path !== 'preset.json' && !path.startsWith('preset_thumb')) expect(Buffer.from(again.files.get(path)!).equals(Buffer.from(bytes)), path).toBe(true);
    }
  });

  it('writes preset.json first and drops unreferenced assets', () => {
    const doc = KlwpDocument.fromBytes(sample('art_deco.klwp'));
    doc.addAsset(PNG, 'unused.png');
    const bytes = doc.toBytes({ thumbs: { portrait: new Uint8Array([0xff, 0xd8, 0xff]) } });
    // First local file header name starts at byte 30.
    expect(new TextDecoder().decode(bytes.subarray(30, 41))).toBe('preset.json');
    const out = readKlwp(bytes);
    expect([...out.files.keys()].some((k) => k.startsWith('bitmaps/IMG'))).toBe(false);
    expect(out.files.has('preset_thumb_portrait.jpg')).toBe(true);
    expect(out.files.has('fonts/ParkLaneNF.ttf')).toBe(true);
  });
});

describe('ops', () => {
  const build = (): { doc: KlwpDocument; results: ReturnType<typeof applyOps> } => {
    const doc = KlwpDocument.create({ title: 'test' });
    const ops: Op[] = [
      { op: 'global', name: 'accent', type: 'COLOR', value: '#FFFF4081' },
      { op: 'set', target: '/', props: { background_color: '#FF101018' } },
      {
        op: 'add',
        parent: '/',
        type: 'StackLayerModule',
        title: 'Clock',
        as: 'clock',
        props: { config_stacking: 'vertical_center', position_anchor: 'CENTER', config_margin: 10 },
        animations: [{ type: 'SCROLL', center: 'CENTER', speed: 200 }],
        children: [
          { type: 'TextModule', as: 'time', props: { text_expression: '$df(HH:mm)$', text_size: 120, paint_color: { global: 'accent' } } },
          { type: 'TextModule', props: { text_expression: '$df(EEEE)$', text_size: 30 } },
        ],
      },
      { op: 'set', target: '@time', props: { fx_shadow: 'OUTER', fx_shadow_distance: 0, fx_shadow_color: '#ff4081' } },
      { op: 'add', parent: '@clock', index: 0, type: 'ShapeModule', props: { shape_type: 'RECT', shape_width: 200, shape_height: 4, paint_color: { formula: '$if(si(darkmode), #FFFFFFFF, #FF000000)$' } } },
      { op: 'events', target: '@time', events: [{ type: 'SINGLE_TAP', action: 'MUSIC', music_action: 'PLAY_PAUSE' }] },
    ];
    return { doc, results: applyOps(doc, ops) };
  };

  it('builds a preset with nested modules, globals, formulas and animations', () => {
    const { doc, results } = build();
    expect(results[2].path).toBe('/0');
    const clock = doc.resolve('#Clock');
    expect(clock.config_stacking).toBe('VERTICAL_CENTER');
    const [line, time] = KlwpDocument.children(clock);
    expect(line.internal_type).toBe('ShapeModule');
    expect(line.internal_toggles).toEqual({ paint_color: 10 });
    expect(time.internal_toggles).toEqual({ paint_color: 100 });
    expect(time.internal_globals).toEqual({ paint_color: 'accent' });
    expect(time.fx_shadow_color).toBe('#FFFF4081');
    expect(doc.validate().filter((i) => i.level === 'error')).toEqual([]);
  });

  it('setting a literal clears a formula or global binding', () => {
    const { doc } = build();
    applyOps(doc, [{ op: 'set', target: '/0/1', props: { paint_color: '#FF00FF00' } }]);
    const time = doc.resolve('/0/1');
    expect(time.internal_toggles).toBeUndefined();
    expect(time.internal_globals).toBeUndefined();
    expect(time.paint_color).toBe('#FF00FF00');
  });

  it('moves, duplicates and removes modules', () => {
    const { doc } = build();
    applyOps(doc, [
      { op: 'duplicate', target: '/0/2', as: 'copy' },
      { op: 'move', target: '@copy', parent: '/', index: 0 },
      { op: 'remove', target: '/1/0' },
    ]);
    expect(KlwpDocument.children(doc.root).map((m) => m.internal_type)).toEqual(['TextModule', 'StackLayerModule']);
    expect(KlwpDocument.children(doc.resolve('/1')).length).toBe(2);
  });

  it.each([
    [{ op: 'set', target: '/', props: { text_size: 3 } }, 'has no property'],
    [{ op: 'add', parent: '/', type: 'TextModule', props: { text_align: 'MIDDLE' } }, 'must be one of LEFT, RIGHT, CENTER'],
    [{ op: 'add', parent: '/', type: 'TextModule', props: { paint_color: 'red' } }, 'must be a colour'],
    [{ op: 'add', parent: '/', type: 'TextModule', props: { paint_color: { global: 'nope' } } }, 'no global named'],
    [{ op: 'add', parent: '/', type: 'Clock' }, 'Unknown module type'],
    [{ op: 'add', parent: '/', type: 'TextModule', children: [{ type: 'TextModule' }] }, 'cannot have children'],
    [{ op: 'set', target: '#Nope', props: {} }, 'No module titled'],
    [{ op: 'remove', target: '/' }, 'root cannot be removed'],
  ] as [Op, string][])('rejects %j', (op, message) => {
    const doc = KlwpDocument.create();
    expect(() => applyOps(doc, [op])).toThrow(message);
  });

  it('suggests close property names', () => {
    const doc = KlwpDocument.create();
    expect(() => applyOps(doc, [{ op: 'add', parent: '/', type: 'TextModule', props: { size: 3 } }])).toThrow(/text_size/);
  });

  it('rolls back the whole batch when one op fails', () => {
    const doc = KlwpDocument.create();
    const before = doc.snapshot();
    expect(() =>
      applyOps(doc, [
        { op: 'add', parent: '/', type: 'TextModule' },
        { op: 'set', target: '/0', props: { text_size: 'big' } },
      ]),
    ).toThrow(/op #1/);
    expect(doc.snapshot()).toBe(before);
  });
});

describe('validate', () => {
  it('reports broken references', () => {
    const doc = KlwpDocument.create();
    applyOps(doc, [
      { op: 'add', parent: '/', type: 'TextModule', props: { text_expression: '$gv(missing)$ $nope(1)$', text_family: 'kfile://org.kustom.provider/fonts/x.ttf' } },
    ]);
    const messages = doc.validate().map((i) => i.message);
    expect(messages.some((m) => m.includes('gv(missing)'))).toBe(true);
    expect(messages.some((m) => m.includes('Unknown function nope'))).toBe(true);
    expect(messages.some((m) => m.includes('fonts/x.ttf is not in the archive'))).toBe(true);
  });

  it('checks icon names against the icon set', () => {
    const doc = KlwpDocument.fromBytes(sample('art_deco.klwp'));
    applyOps(doc, [{ op: 'set', target: '/0/1/0', props: { icon_icon: 'definitely-not-an-icon' } }]);
    expect(doc.validate().some((i) => i.message.includes('definitely-not-an-icon'))).toBe(true);
  });
});

describe('assets', () => {
  it('names images by content hash and fonts by file name', () => {
    const doc = KlwpDocument.create();
    expect(doc.addAsset(PNG, 'photo.png')).toMatch(/^kfile:\/\/org\.kustom\.provider\/bitmaps\/IMG[0-9a-f]{32}$/);
    expect(doc.addAsset(new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'), 'a.svg')).toMatch(/bitmaps\/SVG[0-9a-f]{32}$/);
    expect(doc.addAsset(new Uint8Array([0, 1, 0, 0]), 'My Font.ttf')).toBe('kfile://org.kustom.provider/fonts/My Font.ttf');
    expect(() => doc.addAsset(new Uint8Array([1, 2, 3]), 'notes.txt')).toThrow('not a PNG');
  });
});
