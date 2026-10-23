# klwp reference

## Module references

| Form | Meaning |
| --- | --- |
| `/` | the root (the wallpaper) |
| `/0/2` | child 2 of child 0 of the root (as printed by `inspect`) |
| `#Clock` | the module whose `internal_title` is exactly `Clock` (must be unique) |
| `@clock` | a module created earlier in the same `apply` batch with `"as": "clock"` |

## Operations (`klwp apply file.klwp ops.json`)

The file holds a JSON array (a single object also works). Ops run in order; if one fails, nothing is saved
and the error names the op index. Unknown properties are rejected with suggestions.

```jsonc
// Add a module (or a whole subtree) to a layer. index is optional (default: end).
{ "op": "add", "parent": "/", "index": 0, "type": "StackLayerModule", "title": "Clock", "as": "clock",
  "props": { "config_stacking": "VERTICAL_CENTER", "position_anchor": "CENTER" },
  "animations": [ { "type": "SCROLL", "center": "CENTER", "speed": 200 } ],
  "events": [ { "type": "SINGLE_TAP", "action": "MUSIC", "music_action": "PLAY_PAUSE" } ],
  "children": [ { "type": "TextModule", "props": { "text_expression": "$df(HH:mm)$" } } ] }

{ "op": "set", "target": "#Clock", "title": "New title", "props": { "config_margin": 20, "paint_color": null } }
{ "op": "remove", "target": "/0/1" }
{ "op": "move", "target": "/0/1", "parent": "/2", "index": 0 }      // parent defaults to the current one
{ "op": "duplicate", "target": "#Clock", "as": "clock2" }            // copy is inserted right after
{ "op": "animations", "target": "#Clock", "animations": [ ... ] }    // replaces the list; null clears
{ "op": "events", "target": "#Play", "events": [ ... ] }             // replaces the list; null clears
{ "op": "global", "name": "accent", "type": "COLOR", "value": "#FF00E5FF" }
{ "op": "global", "name": "fg", "type": "COLOR", "formula": "$if(si(darkmode), #FFFFFFFF, #FF000000)$" }
{ "op": "remove-global", "name": "accent" }
{ "op": "asset", "file": "/path/Logo.svg", "as": "logo" }            // then use "bitmap_svg": "asset:logo"
{ "op": "asset", "file": "/path/icons.ttf", "json": "/path/icons.json", "as": "myicons" }
{ "op": "info", "title": "neon", "description": "…", "xscreens": 3 }
```

Module types: `StackLayerModule`, `OverlapLayerModule`, `TextModule`, `ShapeModule`, `FontIconModule`,
`BitmapModule` (the root is `RootLayerModule`). `klwp schema <Type>` lists every property.

### Property value forms

| Value | Effect |
| --- | --- |
| `120`, `"CENTER"`, `"#FF00E5FF"`, `"kfile://org.kustom.provider/fonts/X.ttf"` | literal value (enums are upper-cased) |
| `{ "formula": "$bi(level) * 3.6$" }` | computed by a formula on the device |
| `{ "global": "accent" }` | follows a global variable (create it first) |
| `null` | back to the default |
| `"asset:logo"` | URI of an asset added earlier in the batch |

Setting a literal removes a formula/global on that property. A formula result for a number
property must be numeric; for an enum it must be one of the enum's names.

Global types: `COLOR`, `NUMBER`, `SWITCH` (0/1), `LIST`, `FONT`, `TEXT`, `BITMAP`. A global's
formula overrides its value; `formula: ""` removes it.

## Animations

```json
{ "type": "SCROLL", "center": "CENTER_P1", "speed": 200, "rule": "CENTER", "action": "SCROLL", "angle": 0, "limit": 0 }
```

- `type`: `SCROLL` (horizontal home-screen swipe, previewed) and others that are saved but not previewed
  (`SCROLL_Y`, `GYRO`, `VISUALIZER`, `SWITCH`, `VISIBILITY`, `UNLOCK`, `LOOP_FW`, `LOOP_2W`, `FORMULA`).
- `center`: screen where the module sits at rest. `CENTER` = middle screen (`ceil((n-1)/2)`, 0-based),
  `CENTER_M1..3` / `CENTER_P1..3` left/right of it, `SCREEN1..9`, `FIRST`, `LAST`.
- `speed`: percent. Movement per page = screen width / (screens - 1) × speed / 100.
- `action`: `SCROLL` or `SCROLL_INVERTED` (also FADE, SCALE, ROTATE… not previewed).
- `rule`: `CENTER` (always), `BEFORE_CENTER`/`UP_TO_CENTER` (only left of its screen), `FROM_CENTER`/`AFTER_CENTER`.

## Touch events

```json
{ "type": "SINGLE_TAP", "action": "LAUNCH_APP",
  "intent": "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;component=com.spotify.music/.MainActivity;S.org.kustom.intent.label=Spotify;end" }
{ "type": "SINGLE_TAP", "action": "MUSIC", "music_action": "PLAY_PAUSE" }   // NEXT, PREVIOUS, VOLUME_UP, VOLUME_DOWN, OPEN_APP
{ "type": "SINGLE_TAP", "action": "OPEN_LINK", "url": "https://example.com" }
```

`type`: `SINGLE_TAP`, `DOUBLE_TAP`, `LONG_PRESS`. Launch intents need the app's real package and
activity; when unknown, ask the user or leave events out (the user can pick apps in KLWP).

## Formula language

- Text outside `$…$` is literal; `$$` writes a dollar sign.
- Inside: function calls, numbers, operators and bare words. Bare words need no quotes
  (`$if(mi(state)=PLAYING, pause, play)$`); quote text containing commas or brackets: `"a, b"`.
- Operators by precedence (low → high): `&` `|`; `=` `!=` `<` `<=` `>` `>=` `~=` (regex match);
  `+` `-`; `*` `/` `%`; `^`; unary `-`. Comparisons give 1/0. `=` compares case-insensitively.
- Operators on non-numbers join text: `$a + b$` → `ab`, `$gold-1$` → `gold-1`.
- Numbers print without trailing zeros, floored to 5 decimals.
- `if(c1, v1, c2, v2, …, else)`: a condition is true unless it is empty or `0`.

### Functions

| Function | Meaning (preview value) |
| --- | --- |
| `df(format[, date])` | Date/time. Letters: `H` 0-23, `h` 1-12, `k` 1-24, `m`, `s`, `a` AM/PM, `d`, `dd`, `EEE` Mon, `EEEE` Monday, `M`/`MM`, `MMM` Oct, `MMMM` October, `yy`, `yyyy`, `D` day of year, `w` week, `e` weekday number (Mon = 1). Quote literal text: `'at'`. `date` may shift: `a1d` (+1 day), `r2h` (−2 hours), units s m h d w M y |
| `tf(seconds, format)` | Duration, e.g. `$tf(mi(pos), mm:ss)$` → `01:35` |
| `dp(date)` | Unix seconds |
| `tc(mode, text, …)` | `up`, `low`, `cap`, `len`, `cut, text, n` (first n chars; negative = last n) or `cut, text, start, len`, `ell, text, n`, `ord, n` (st/nd/rd/th), `n2w, n` (number to words), `roman`, `lpad/rpad, text, width, char`, `reg, text, regex, repl`, `split, text, sep, i`, `utf, hex`, `url`, `html`, `nfmt`, `count, text, sub`, `lines` |
| `mu(fn, …)` | `round[, digits]`, `floor`, `ceil`, `abs`, `min`, `max`, `sqrt`, `pow`, `log`, `ln`, `sin`/`cos`/`tan` (degrees), `asin`…, `rnd, lo, hi`, `h2d`, `d2h` |
| `gv(name)` | Global value |
| `bi(key)` | Battery: `level` (76), `charging` (0), `temp`, `volt`, `source` |
| `wi(key)` | Weather: `temp` (21), `tempu` (C), `cond` (partly cloudy), `code`, `hum`, `wspeed`, `wspeedu`, `wdir`, `flik`, `clouds`, `uvindex`, `press` |
| `mi(key)` | Music: `title` (Midnight City), `artist` (M83), `album`, `state` (PLAYING/PAUSED/STOPPED), `pos`/`len` (seconds), `percent` (39), `cover` (album art image; empty in preview), `package`, `vol` |
| `si(key)` | System: `darkmode` (1/0), `locked`, `land`, `screen` |
| `ai(key)` | Astronomy: `isday` (1 between 06:42 and 19:18), `sunrise`, `sunset`, `mphase` |
| `nc`, `ni`, `ci`, `li`, `wf`, `wg`, `br`, `aq`, `cm`, `ce`, `bp`, `rm`, `sh`, `tu`, `uc`, `fd`, `gh`, `mq`, `lv`, `fl` | Real KLWP functions (notifications, calendar, location, forecast, traffic, RSS…) that work on the phone but render empty in the preview |

## Render options

`--screen N` (1-based, default the middle screen) or `--all`; `--screens N` overrides the screen count;
`--time 2025-10-23T19:29`; `--dark`; `--paused`; `--battery 40`; `--scale 1` for full device resolution
(default 0.5 = 540 px wide per screen); `--outline`; `--boxes`; `--compare ref.png`.
