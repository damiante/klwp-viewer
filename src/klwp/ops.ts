// JSON batch operations over a KlwpDocument. This is the interface LLM agents and scripts
// use (`klwp apply`): each op is a plain object, applied in order, all-or-nothing.

import type { ModuleJson, PresetInfo } from './archive';
import { EditError, type GlobalSpec, KlwpDocument, type ModuleSpec, type PropValue } from './document';

export type Op =
  | ({ op: 'add'; parent: string; index?: number } & ModuleSpec)
  | { op: 'set'; target: string; title?: string | null; props?: Record<string, PropValue>; raw?: boolean }
  | { op: 'remove'; target: string }
  | { op: 'move'; target: string; parent?: string; index?: number }
  | { op: 'duplicate'; target: string; as?: string }
  | { op: 'animations'; target: string; animations: Record<string, unknown>[] | null }
  | { op: 'events'; target: string; events: Record<string, unknown>[] | null }
  | ({ op: 'global'; name: string } & GlobalSpec)
  | { op: 'remove-global'; name: string }
  | { op: 'asset'; file: string; as?: string; kind?: 'font' | 'bitmap' | 'icons'; json?: string }
  | { op: 'info'; title?: string; description?: string; author?: string; width?: number; height?: number; xscreens?: number };

export interface OpResult {
  op: string;
  /** Path of the created/affected module, when there is one. */
  path?: string;
  /** kfile:// URI of an added asset. */
  uri?: string;
}

export interface OpContext {
  /** Reads a local file for "asset" ops (CLI only). */
  readFile?: (path: string) => Uint8Array;
}

const ASSET_REF = /^asset:([\w-]+)$/;

/** Replaces "asset:<alias>" strings in prop values with the URI of an asset added earlier. */
function resolveAssets(props: Record<string, PropValue> | undefined, assets: Map<string, string>) {
  if (!props) return props;
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(props)) {
    const m = typeof v === 'string' ? ASSET_REF.exec(v) : null;
    if (m && !assets.has(m[1])) throw new EditError(`${k}: unknown asset alias "${m[1]}"`);
    out[k] = m ? assets.get(m[1])! : v;
  }
  return out;
}

function resolveSpec(spec: ModuleSpec, assets: Map<string, string>): ModuleSpec {
  return { ...spec, props: resolveAssets(spec.props, assets), children: spec.children?.map((c) => resolveSpec(c, assets)) };
}

/**
 * Applies ops in order. On any error the document is restored and an EditError naming the
 * failing op is thrown, so a batch never leaves a half-edited preset.
 */
export function applyOps(doc: KlwpDocument, ops: Op[], ctx: OpContext = {}): OpResult[] {
  if (!Array.isArray(ops)) throw new EditError('Expected a JSON array of operations');
  const before = doc.snapshot();
  const filesBefore = new Map(doc.files);
  const aliases = new Map<string, ModuleJson>();
  const assets = new Map<string, string>();
  const results: OpResult[] = [];
  const path = (m: ModuleJson) => doc.pathOf(m) ?? undefined;
  ops.forEach((op, i) => {
    try {
      results.push(applyOne(doc, op, aliases, assets, ctx, path));
    } catch (e) {
      doc.restore(before);
      doc.files = filesBefore;
      const msg = e instanceof Error ? e.message : String(e);
      throw new EditError(`op #${i} (${(op as { op?: string })?.op ?? '?'}): ${msg}`);
    }
  });
  // Paths shift as modules are inserted, so report final paths for named modules.
  for (const r of results) {
    const alias = (r as OpResult & { alias?: string }).alias;
    if (alias && aliases.has(alias)) r.path = path(aliases.get(alias)!);
  }
  return results;
}

function applyOne(
  doc: KlwpDocument,
  op: Op,
  aliases: Map<string, ModuleJson>,
  assets: Map<string, string>,
  ctx: OpContext,
  path: (m: ModuleJson) => string | undefined,
): OpResult {
  const target = (ref: string) => doc.resolve(ref, aliases);
  switch (op?.op) {
    case 'add': {
      const { op: _op, parent, index, ...spec } = op;
      const m = doc.addModule(target(parent), resolveSpec(spec as ModuleSpec, assets), index, aliases);
      return { op: 'add', path: path(m), ...(spec.as ? { alias: spec.as } : {}) } as OpResult;
    }
    case 'set': {
      const m = target(op.target);
      if (op.title !== undefined) doc.setTitle(m, op.title);
      for (const [k, v] of Object.entries(resolveAssets(op.props, assets) ?? {})) doc.setProp(m, k, v, { raw: op.raw });
      return { op: 'set', path: path(m) };
    }
    case 'remove': {
      doc.removeModule(target(op.target));
      return { op: 'remove' };
    }
    case 'move': {
      const m = target(op.target);
      const parent = op.parent ? target(op.parent) : doc.parentOf(m);
      if (!parent) throw new EditError('The root cannot be moved');
      doc.moveModule(m, parent, op.index);
      return { op: 'move', path: path(m) };
    }
    case 'duplicate': {
      const copy = doc.duplicate(target(op.target));
      if (op.as) aliases.set(op.as, copy);
      return { op: 'duplicate', path: path(copy), ...(op.as ? { alias: op.as } : {}) } as OpResult;
    }
    case 'animations': {
      const m = target(op.target);
      doc.setAnimations(m, op.animations);
      return { op: 'animations', path: path(m) };
    }
    case 'events': {
      const m = target(op.target);
      doc.setEvents(m, op.events);
      return { op: 'events', path: path(m) };
    }
    case 'global': {
      const { op: _op, name, ...spec } = op;
      doc.setGlobal(name, spec);
      return { op: 'global' };
    }
    case 'remove-global':
      doc.removeGlobal(op.name);
      return { op: 'remove-global' };
    case 'asset': {
      if (!ctx.readFile) throw new EditError('asset ops need file access (use the CLI)');
      const bytes = ctx.readFile(op.file);
      const json = op.json ? ctx.readFile(op.json) : undefined;
      const uri = doc.addAsset(bytes, op.file, { kind: op.kind ?? (json ? 'icons' : undefined), iconJson: json });
      if (op.as) assets.set(op.as, uri);
      return { op: 'asset', uri };
    }
    case 'info': {
      const { op: _op, ...fields } = op;
      for (const [k, v] of Object.entries(fields)) {
        if (['width', 'height', 'xscreens'].includes(k) && !(Number.isInteger(v) && (v as number) > 0)) throw new EditError(`${k} must be a positive integer`);
        (doc.info as PresetInfo & Record<string, unknown>)[k] = v;
      }
      return { op: 'info' };
    }
    default:
      throw new EditError(`Unknown op "${(op as { op?: string })?.op}". Use add, set, remove, move, duplicate, animations, events, global, remove-global, asset or info`);
  }
}
