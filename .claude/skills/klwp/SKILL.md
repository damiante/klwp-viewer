---
name: klwp
description: Create, edit, inspect, render and export Kustom Live Wallpaper (KLWP) presets (.klwp files) with the klwp CLI. Use when asked to design an Android live wallpaper or KLWP preset from a text prompt or a reference image, to change an existing .klwp, or to preview one as a PNG.
---

# Building KLWP presets with the `klwp` CLI

A `.klwp` file is a zip holding `preset.json` (a tree of modules) plus the fonts, icon fonts and
images it uses. The `klwp` CLI edits that tree through validated JSON operations and renders it
headlessly, so you can work in a loop: **plan → apply ops → render → look → adjust → validate**.

## Setup

The CLI lives in the repository that contains this skill: the repo root is three directories above
this skill's base directory (`<repo>/.claude/skills/klwp`). Run it as:

```sh
node <repo>/dist-cli/klwp.mjs <command> ...
```

If `dist-cli/klwp.mjs` is missing or the sources changed, build it first:
`npm --prefix <repo> install` (first time only), then `npm --prefix <repo> run -s build:cli`.
`node <repo>/dist-cli/klwp.mjs --help` lists every command. Below, `klwp` stands for that command.

## Workflow

1. **Plan the design before touching files.** Decide the home screens (usually 3: left, centre,
   right) and what goes on each. Pick a palette (make each colour a global), fonts and icon sets.
   With a reference image, measure positions as fractions of the screen and convert them to
   units (see Coordinates).
2. **Create the preset:** `klwp new out.klwp --title my-wallpaper --screens 3`.
3. **Bring in assets:**
   - Fonts or images from disk: `klwp asset-add out.klwp /path/Font.ttf` prints the `kfile://` URI to use.
   - Icon sets and stock fonts from another archive: `klwp import out.klwp --from <archive>` lists
     what is available, then `klwp import out.klwp --from <archive> icons/material.ttf fonts/X.ttf`.
     Good sources: `<repo>/klwp_google_release_382.apk` (if present: `assets/icons/{material,fontawesome,entypo,meteo}.ttf`,
     `assets/fonts/*.ttf`), and `<repo>/public/samples/*.klwp`.
   - Find icon names with `klwp icons out.klwp --set material.ttf --search arrow`. Never guess them.
4. **Build the module tree** with one ops file: `klwp apply out.klwp ops.json` (or `--ops '<json>'`).
   A batch is all-or-nothing; the output lists the path of every added module and any validation errors.
5. **Look at the result:** `klwp render out.klwp --all -o /tmp/shot.png`, then view the PNG.
   Add `--outline` to label every module box with its path, `--compare ref.png` to show a
   reference image beside the render, and `--boxes` for exact positions in units (as JSON).
   Read the `note:` lines on stderr: they name missing assets and unknown functions.
6. **Iterate** with small batches (`apply`) or quick edits:
   `klwp set out.klwp '#Time' text_size=160 paint_color=#FFFF4081` (values: number, text,
   `null` to reset, or JSON such as `'{"global":"accent"}'`).
7. **Finish:** `klwp validate out.klwp` must report no errors, then shrink the archive with
   `klwp apply out.klwp --ops '[]' --prune` (drops imported files nothing uses) and render once more.

Read before editing an existing preset: `klwp inspect file.klwp` (tree with paths, titles and key
settings), `klwp get file.klwp /0/2 --all` (one module including defaults),
`klwp schema TextModule` (every property with its type, default and allowed values).

## Coordinates and sizes

- 1 unit = 1/720 of the screen's **short side**. A 540x1200 preset (the default, a 1080x2400 phone)
  is **720 x 1600 units**. All sizes, paddings, offsets and margins are in units.
- Every layer's `config_scale_value` (percent) scales everything **inside** it, not its own margin/padding.
- Text: `text_size` is the font size in units (a hero clock is ~150–260, body text 30–45).
- `render --boxes` reports module boxes in these units, so you can compare with a target layout.

## Layout model (how KLWP places things)

- **Root** (`/`): the screen. Its children are placed by `position_anchor` (TOP, CENTER, BOTTOMRIGHT…;
  default TOP for root children) plus `position_offset_x/y`. **Offsets only work on root children**
  and push inward from the anchored edge (a BOTTOM anchor with `position_offset_y: 120` sits 120 units up).
- **OverlapLayerModule**: children are drawn on top of each other, each placed by its own anchor
  (default CENTER). The layer is as big as its largest child. Use for cards, badges, clock faces.
- **StackLayerModule**: a row or column (`config_stacking`: VERTICAL_LEFT/CENTER/RIGHT,
  HORIZONTAL_TOP/CENTER/BOTTOM) with `config_margin` between children. Children's anchors are ignored.
- Inside layers, move things with `position_padding_*` (padding enlarges the module's box) or
  spacer shapes; there is no free x/y positioning below the root.
- Build one top-level layer per widget group (clock, weather, music…), give each a `title`, and
  address it later as `#Title`.

## Multiple home screens

Give each top-level group a SCROLL animation that pins it to a screen:

```json
"animations": [{ "type": "SCROLL", "center": "CENTER", "speed": 200 }]
```

`center` is `CENTER` (middle screen), `CENTER_M1`/`CENTER_P1` (one left/right of it), `SCREEN1`…`SCREEN9`,
`FIRST` or `LAST`. Use `speed = 100 * (screens - 1)` so a group moves exactly one screen per page
(200 for 3 screens, 300 for 4). Without an animation a group is visible on every screen.
Render all screens with `--all`; pick one with `--screen N` (1-based).

## Styling recipes

- **Colours** are `#AARRGGBB` (alpha first). `#RRGGBB` is accepted and made opaque.
- **Palette**: `{"op":"global","name":"accent","type":"COLOR","value":"#FF00E5FF"}`, then bind a
  property with `"paint_color": {"global": "accent"}`. Change the global to recolour everything.
- **Neon glow**: `fx_shadow: "OUTER"`, `fx_shadow_distance: 0`, `fx_shadow_blur: 40–90`,
  `fx_shadow_color` = the glow colour. **Drop shadow**: distance 4–10, direction 315 (down-right).
- **Gradient**: `fx_gradient: "HORIZONTAL"|"VERTICAL"|"RADIAL"|"SWEEP"` goes from `paint_color` to
  `fx_gradient_color`; `"BITMAP"` with `fx_gradient_bitmap` fills text with an image.
- **Outline only**: `paint_style: "STROKE"`, `paint_stroke: 3`.
- **Progress bar**: an Overlap with a full-width track RECT and a `CENTERLEFT`-anchored fill RECT whose
  `shape_width` is a formula, e.g. `{"formula": "$mi(percent) * 4.8$"}` for a 480-unit bar.
- **Progress ring**: SLICE shape (`shape_width` = diameter, `shape_height` = thickness,
  `shape_angle: {"formula": "$bi(level) * 3.6$"}`).
- **Analog clock hands**: an Overlap per hand with `config_rotate_mode: CLOCK_HOUR_SMOOTH` /
  `CLOCK_MINUTE`, containing a RECT with `position_padding_bottom` equal to its height so it pivots
  at its end. See `examples/analog-clock-battery-ring.json`.
- **Text that must fit** (song titles, long dates): `text_size_type: "FIT_TO_BOX"` with
  `text_width`/`text_height`, or `FIXED_WIDTH` with `text_lines` to wrap and truncate.

## Formulas (short version, details in reference.md)

Text properties mix literal text with `$...$` blocks: `"$df(EEEE)$, $df(d)$$tc(ord, df(d))$ $df(MMMM)$"`.
Any property can be formula-driven: `{"formula": "$if(si(darkmode), #FFFFFFFF, #FF000000)$"}`.
Common: `df(hh:mm)` time, `df(HH:mm)` 24h, `df(EEEE)` weekday, `bi(level)` battery,
`wi(temp)`/`wi(tempu)`/`wi(cond)` weather, `mi(title|artist|album|state|percent)` music,
`if(cond, a, b)`, `tc(up|low|cap, text)`, `gv(name)` global value, `mu(round, x)` maths.
Check a formula with `klwp eval file.klwp '$df(EEEE)$'` (uses simulated device data).

## Pitfalls

- Paths (`/0/2/1`) shift when you add, move or remove modules. Within one batch use `"as": "name"`
  and `@name`; across batches prefer unique `title`s and `#Title`; re-run `inspect` when unsure.
- `#Title` must match exactly one module.
- Missing images reserve a square of `bitmap_width` (that is what the app does too) and push stacks apart.
- A Text module without `text_family` uses the phone's Roboto; the preview approximates it with a system font.
- Use only icon names listed by `klwp icons`; invalid names render nothing (`validate` reports them).
- The preview simulates device data (time is real unless `--time`; battery 76 %, 21 °C partly cloudy,
  song "Midnight City" by M83 playing). Notification, calendar and similar providers render empty.
- Not previewed but saved correctly: `paint_mode` blend modes, `fx_mask`, layer `config_fx`,
  colour filters, `bitmap_dim`, animations other than horizontal SCROLL, and touch events
  (the wallpaper still runs them on the phone).

## Files

- `reference.md`: every op, value forms, formula functions and date letters, touch event formats.
- `examples/neon-clock-music.json`: two-screen preset (glowing clock, date, weather row, music card with
  progress bar and controls). Needs Sarpanch-Regular.ttf, RobotoCondensed-Light.ttf, material.ttf
  and meteo.ttf imported from the APK first.
- `examples/analog-clock-battery-ring.json`: analog clock with hands and a battery ring, no assets needed.

The web editor in the same repo (`npm --prefix <repo> run dev`) opens the same files if the user
wants to fine-tune by hand.
