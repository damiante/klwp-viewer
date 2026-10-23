# KLWP Editor

View, edit and export Kustom Live Wallpaper presets (`.klwp`). The web editor runs entirely
client-side and is live at **https://damiantesta.com/klwp-viewer/** (deployed from `main` by
GitHub Actions); the `klwp` CLI does the same edits headlessly and renders PNGs, for scripts and
LLM agents.

```sh
npm install
npm run dev        # web editor at http://localhost:5173/?preset=samples/art_deco.klwp
npm test           # formula engine, document model, ops, CLI end-to-end
npm run build      # static site in dist/ (relative paths) + CLI in dist-cli/
```

## Web editor

Open a `.klwp` (or drop it on the page), pick a sample, or press **New**. Select modules in the
layer tree or by clicking the preview (click again to cycle through overlapping modules). The
inspector edits every property of the selected module; each property can be a value (`=`), a
formula (`ƒ`) or bound to a global (`gv`). Select the root for preset settings and globals.
Fonts, images and icon sets (an icon `.ttf` plus its IcoMoon `.json`) are uploaded from the
asset dropdowns. **Export .klwp** writes the archive with thumbnails, leaving out unused files.
Undo/redo: Ctrl+Z / Ctrl+Shift+Z.

## CLI

```sh
npm run -s build:cli
node dist-cli/klwp.mjs --help
node dist-cli/klwp.mjs new my.klwp --title my-wallpaper
node dist-cli/klwp.mjs apply my.klwp ops.json            # JSON batch of add/set/move/... ops
node dist-cli/klwp.mjs render my.klwp --all --outline -o shot.png
node dist-cli/klwp.mjs validate my.klwp
```

The Claude Code skill in [.claude/skills/klwp](.claude/skills/klwp/SKILL.md) documents the workflow,
the op format, formulas and design recipes, with worked examples.

## How it works

A `.klwp` file is a zip containing `preset.json` plus the fonts, icon sets and bitmaps it references
via `kfile://` URIs. Presets omit every property left at its default, so the defaults, layout rules
and formula semantics were recovered from the Android app (`klwp_google_release_382.apk`):

| Area | Source in the APK | Here |
| --- | --- | --- |
| Properties, defaults, enums | `ye.*` module specs, `org.kustom.lib.options` | `src/klwp/schema.ts` |
| Formula language | `org.kustom.lib.parser`, Javaluator | `src/klwp/formula.ts`, `functions.ts` |
| Units, layers, anchors, padding | `RenderModule`, `LayerModule`, `view.g`, `view.a0` | `src/klwp/render.ts` |
| Text sizing, shadows, gradients, shapes | `view.c`, `view.q`, `view.z`, `view.y` | `src/klwp/render.ts` |
| Home-screen scroll animation | `AnimationModule`, `AnimationCenter` | `src/klwp/render.ts` |
| Archive layout on export | `PresetExporter` | `src/klwp/archive.ts` |

Editing (`src/klwp/document.ts`, `ops.ts`) is shared by the web UI and the CLI; rendering uses the
browser canvas or `@napi-rs/canvas` (Skia) in Node.

One unit is `min(screen width, height) / 720` pixels, multiplied by each ancestor layer's scale.

## Limitations

- Editable module types: root, stack and overlap layers, text, shape, image and font icon. Progress,
  series, curved text, movie and komponent modules are kept as-is but not editable or previewed.
- Device data is simulated; notification, calendar, traffic and similar providers render empty.
- Saved but not previewed: animations other than horizontal scroll, blend modes, masks, layer
  effects, colour filters. BBCode text formatting is stripped in the preview.
- Exported files follow the app's format, but have not yet been loaded on a phone.
