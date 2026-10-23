import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readKlwp } from '../src/klwp/archive';

const dir = mkdtempSync(join(tmpdir(), 'klwp-cli-'));
const run = (...args: string[]) => execFileSync('node', ['dist-cli/klwp.mjs', ...args], { encoding: 'utf8' });

beforeAll(() => {
  execFileSync('npm', ['run', '-s', 'build:cli']);
});

describe('klwp CLI', () => {
  it('creates, edits, validates and renders a preset', () => {
    const file = join(dir, 'clock.klwp');
    run('new', file, '--title', 'Clock');
    const ops = [
      { op: 'set', target: '/', props: { background_color: '#FF0B0B12' } },
      {
        op: 'add',
        parent: '/',
        type: 'StackLayerModule',
        title: 'Clock',
        props: { config_stacking: 'VERTICAL_CENTER', position_anchor: 'CENTER' },
        children: [
          { type: 'TextModule', title: 'Time', props: { text_expression: '$df(HH:mm)$', text_size: 140 } },
          { type: 'ShapeModule', props: { shape_type: 'RECT', shape_width: 300, shape_height: 4, paint_color: '#FFFF4081' } },
        ],
      },
    ];
    writeFileSync(join(dir, 'ops.json'), JSON.stringify(ops));
    const out = JSON.parse(run('apply', file, join(dir, 'ops.json')));
    expect(out.errors).toEqual([]);
    expect(run('validate', file)).toContain('ok');
    expect(run('inspect', file)).toMatch(/\/0\/0 +Text "Time" "\$df\(HH:mm\)\$"/);

    const boxes = JSON.parse(run('render', file, '-o', join(dir, 'out.png'), '--boxes', '--time', '2025-01-01T09:41'));
    const time = boxes.boxes.find((b: { title?: string }) => b.title === 'Time');
    expect(time.w).toBeGreaterThan(200);
    expect(readFileSync(join(dir, 'out.png')).subarray(1, 4).toString()).toBe('PNG');

    const archive = readKlwp(new Uint8Array(readFileSync(file)));
    expect(archive.files.has('preset_thumb_portrait.jpg')).toBe(true);
    expect(archive.info.title).toBe('Clock');
  });

  it('applies ops from --ops and reports errors with a non-zero exit', () => {
    const file = join(dir, 'bad.klwp');
    run('new', file);
    const r = spawnSync('node', ['dist-cli/klwp.mjs', 'apply', file, '--ops', '[{"op":"add","parent":"/","type":"TextModule","props":{"text_size":"big"}}]'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('text_size must be a number');
  });

  it('quick set and eval work against the samples', () => {
    const file = join(dir, 'deco.klwp');
    writeFileSync(file, readFileSync('public/samples/art_deco.klwp'));
    run('set', file, '/0/0/1/2', 'text_size=30', 'text_expression=$df(HH:mm)$', '--no-thumbs');
    expect(JSON.parse(run('get', file, '/0/0/1/2')).text_size).toBe(30);
    expect(run('eval', file, '$gv(colour-1)$').trim()).toBe('#FFD3BC5F');
    expect(run('icons', file, '--set', 'Old-material-design.ttf', '--search', 'skip-n')).toContain('skip-next');
  });

  it('imports icon sets from another archive', () => {
    const file = join(dir, 'icons.klwp');
    run('new', file);
    expect(run('import', file, '--from', 'public/samples/art_deco.klwp', 'icons/fontawesome.ttf')).toContain('icons/fontawesome.ttf');
    expect(run('icons', file)).toContain('fontawesome.ttf');
  });
});
