// Module property schema recovered from the app's module specs (ye.* classes) and option
// enums (org.kustom.lib.options.*). Single source for defaults, validation, the web
// inspector and the CLI `schema` command. Presets omit properties left at their default.

export type PropType =
  | 'number' // free number, in KLWP units when it is a size
  | 'percent' // 0..100
  | 'angle' // degrees
  | 'text' // plain text
  | 'formula' // text evaluated as a KLWP formula ($...$ blocks)
  | 'color' // #AARRGGBB
  | 'enum'
  | 'font' // kfile:// URI of a .ttf/.otf in fonts/
  | 'bitmap' // kfile:// URI of an image in bitmaps/
  | 'iconset' // kfile:// URI of an icon font in icons/
  | 'icon'; // icon name inside the icon set

export interface PropDef {
  key: string;
  type: PropType;
  default: unknown;
  values?: readonly string[];
  desc: string;
}

export interface Section {
  name: string;
  props: PropDef[];
}

export const ENUMS = {
  anchor: ['TOPLEFT', 'TOP', 'TOPRIGHT', 'CENTERLEFT', 'CENTER', 'CENTERRIGHT', 'BOTTOMLEFT', 'BOTTOM', 'BOTTOMRIGHT'],
  stacking: ['VERTICAL_LEFT', 'VERTICAL_CENTER', 'VERTICAL_RIGHT', 'HORIZONTAL_TOP', 'HORIZONTAL_CENTER', 'HORIZONTAL_BOTTOM'],
  visible: ['ALWAYS', 'IF_NOT_LOCKED', 'IF_LOCKED', 'IF_LANDSCAPE', 'IF_PORTRAIT', 'NEVER', 'REMOVE'],
  rotate: ['NONE', 'FLIP_X', 'FLIP_Y', 'DEG90', 'DEG180', 'DEG270', 'MANUAL', 'CLOCK_HOUR_SMOOTH', 'CLOCK_HOUR',
    'CLOCK_MINUTE_SMOOTH', 'CLOCK_MINUTE', 'CLOCK_SECOND_SMOOTH', 'CLOCK_SECOND'],
  paintStyle: ['FILL', 'STROKE'],
  paintMode: ['NORMAL', 'CLEAR', 'SRC', 'DST', 'XOR', 'DARKEN', 'LIGHTEN', 'SCREEN', 'ADD', 'OVERLAY', 'MULTIPLY'],
  gradient: ['NONE', 'HORIZONTAL', 'VERTICAL', 'RADIAL', 'SWEEP', 'BITMAP'],
  tileMode: ['FIT_CENTER', 'REPEAT', 'MIRROR'],
  shadow: ['NONE', 'OUTER'],
  mask: ['NONE', 'BACKGROUND', 'BLURRED', 'CLIP_NEXT', 'CLIP_ALL', 'LIQUID_GLASS'],
  colorFilter: ['NONE', 'BW', 'SEPIA', 'DESATURATE', 'INVERT', 'COLORIZE', 'HUE', 'CONTRAST', 'BRIGHTEN', 'DARKEN'],
  fontSize: ['SINGLE_FONT_HEIGHT', 'SINGLE_FIXED_WIDTH', 'FIXED_WIDTH', 'FIT_TO_BOX'],
  textAlign: ['LEFT', 'RIGHT', 'CENTER'],
  shape: ['SQUARE', 'CIRCLE', 'RECT', 'OVAL', 'TRIANGLE', 'RTRIANGLE', 'EXAGON', 'SLICE', 'ARC', 'SQUIRCLE', 'PATH'],
  pathScale: ['AUTO', 'CENTER_FIT'],
  bitmapMode: ['BITMAP', 'VECTOR'],
  bitmapScale: ['FIT_WIDTH', 'FIT_HEIGHT', 'CENTER_FIT', 'CENTER_CROP'],
  iconColor: ['DEFAULT', 'MONOCHROME', 'COLORIZE', 'INVERT'],
  backgroundType: ['SOLID', 'IMAGE'],
  backgroundScroll: ['NORMAL', 'NONE', 'INVERTED'],
  layerFx: ['NONE', 'DROP_SHADOW', 'LONG_SHADOW_BR', 'LONG_SHADOW_BL', 'LONG_SHADOW_TR', 'LONG_SHADOW_TL', 'VIGNETTE',
    'SCANLINE', 'SCANLINE_FADE', 'PIXELATE', 'DUOTONE'],
  globalType: ['COLOR', 'NUMBER', 'SWITCH', 'LIST', 'FONT', 'TEXT', 'BITMAP'],
  // Animations (AnimationModule) and touch events (TouchEvent)
  animationType: ['DISABLED', 'SCROLL', 'SCROLL_Y', 'GYRO', 'VISUALIZER', 'SWITCH', 'VISIBILITY', 'UNLOCK', 'LOOP_FW', 'LOOP_2W', 'FORMULA'],
  animationAction: ['SCROLL', 'SCROLL_INVERTED', 'SCALE', 'SCALE_X', 'SCALE_Y', 'SCALE_INVERTED', 'SKEW_X', 'SKEW_Y', 'FADE',
    'FADE_INVERTED', 'ROTATE', 'ROTATE_INVERTED', 'ADVANCED', 'COLOR', 'COLOR_INVERTED', 'FLIP_HORIZONTAL', 'FLIP_VERTICAL'],
  animationRule: ['CENTER', 'BEFORE_CENTER', 'UP_TO_CENTER', 'FROM_CENTER', 'AFTER_CENTER'],
  animationCenter: ['CENTER', 'FIRST', 'LAST', 'SCREEN1', 'SCREEN2', 'SCREEN3', 'SCREEN4', 'SCREEN5', 'SCREEN6', 'SCREEN7',
    'SCREEN8', 'SCREEN9', 'CENTER_M1', 'CENTER_M2', 'CENTER_M3', 'CENTER_P1', 'CENTER_P2', 'CENTER_P3'],
  touchType: ['SINGLE_TAP', 'DOUBLE_TAP', 'LONG_PRESS'],
  touchAction: ['NONE', 'KUSTOM_ACTION', 'LAUNCH_APP', 'LAUNCH_SHORTCUT', 'MUSIC', 'SWITCH_GLOBAL', 'OPEN_LINK', 'CHANGE_VOLUME', 'DISABLED'],
  musicAction: ['PLAY_PAUSE', 'NEXT', 'PREVIOUS', 'VOLUME_UP', 'VOLUME_DOWN', 'OPEN_APP'],
} as const;

const p = (key: string, type: PropType, def: unknown, desc: string, values?: readonly string[]): PropDef => ({
  key,
  type,
  default: def,
  desc,
  values,
});

const POSITION: Section = {
  name: 'position',
  props: [
    p('position_anchor', 'enum', 'CENTER', 'Where the module sits inside its parent (root children default to TOP). Ignored inside stacks.', ENUMS.anchor),
    p('position_offset_x', 'number', 0, 'Horizontal offset from the anchor, in units. Only applies to direct children of the root; moves inward from right anchors.'),
    p('position_offset_y', 'number', 0, 'Vertical offset from the anchor, in units. Only applies to direct children of the root; moves inward (up) from bottom anchors.'),
    p('position_padding_left', 'number', 0, 'Padding in units; enlarges the module box.'),
    p('position_padding_top', 'number', 0, 'Padding in units.'),
    p('position_padding_right', 'number', 0, 'Padding in units.'),
    p('position_padding_bottom', 'number', 0, 'Padding in units.'),
  ],
};

const PAINT: Section = {
  name: 'paint',
  props: [
    p('paint_color', 'color', '#FFFFFFFF', 'Fill/stroke colour (#AARRGGBB).'),
    p('paint_style', 'enum', 'FILL', 'FILL or STROKE (outline only).', ENUMS.paintStyle),
    p('paint_stroke', 'number', 1, 'Stroke width in units when paint_style is STROKE.'),
    p('paint_mode', 'enum', 'NORMAL', 'Blend mode (only NORMAL is previewed).', ENUMS.paintMode),
  ],
};

const FX: Section = {
  name: 'fx',
  props: [
    p('fx_gradient', 'enum', 'NONE', 'Gradient from paint_color to fx_gradient_color, or BITMAP to fill with an image.', ENUMS.gradient),
    p('fx_gradient_color', 'color', '#FF000000', 'Second gradient colour.'),
    p('fx_gradient_width', 'percent', 100, 'Gradient spread (0..100).'),
    p('fx_gradient_offset', 'percent', 50, 'Gradient centre position (0..100).'),
    p('fx_gradient_offset_x', 'percent', 50, 'Radial/sweep centre X (0..100).'),
    p('fx_gradient_offset_y', 'percent', 50, 'Radial/sweep centre Y (0..100).'),
    p('fx_gradient_bitmap', 'bitmap', '', 'Image used when fx_gradient is BITMAP.'),
    p('fx_gradient_bitmap_mode', 'enum', 'FIT_CENTER', 'How the gradient image is tiled.', ENUMS.tileMode),
    p('fx_gradient_bitmap_width', 'number', 20, 'Tile width in units for REPEAT/MIRROR.'),
    p('fx_shadow', 'enum', 'NONE', 'OUTER draws a drop shadow / glow.', ENUMS.shadow),
    p('fx_shadow_color', 'color', '#FF000000', 'Shadow colour; a saturated colour with distance 0 gives a neon glow.'),
    p('fx_shadow_blur', 'number', 30, 'Shadow softness (blur radius = value / 4 px).'),
    p('fx_shadow_distance', 'number', 15, 'Shadow offset in units.'),
    p('fx_shadow_direction', 'angle', 45, 'Shadow direction in degrees, 0 = right, 90 = up.'),
    p('fx_mask', 'enum', 'NONE', 'Masking (not previewed).', ENUMS.mask),
  ],
};

const layerSection = (stack: boolean): Section => ({
  name: 'layer',
  props: [
    ...(stack
      ? [
          p('config_stacking', 'enum', 'VERTICAL_LEFT', 'Stack direction and cross-axis alignment.', ENUMS.stacking),
          p('config_margin', 'number', 0, 'Gap between stacked children, in units.'),
        ]
      : []),
    p('config_scale_value', 'number', 100, 'Scale (%) applied to every size inside this layer.'),
    p('config_visible', 'enum', 'ALWAYS', 'Visibility; REMOVE also frees the space. Often driven by a formula.', ENUMS.visible),
    p('config_rotate_mode', 'enum', 'NONE', 'Rotation of the whole layer.', ENUMS.rotate),
    p('config_rotate_offset', 'angle', 0, 'Rotation in degrees for MANUAL (added to clock modes).'),
    p('config_alpha', 'percent', 100, 'Layer opacity (0..100).'),
    p('config_fx', 'enum', 'NONE', 'Layer effect (not previewed).', ENUMS.layerFx),
  ],
});

const rotateProps = (prefix: string): PropDef[] => [
  p(`${prefix}_rotate_mode`, 'enum', 'NONE', 'Rotation mode; CLOCK_* modes follow the time (analog clock hands).', ENUMS.rotate),
  p(`${prefix}_rotate_offset`, 'angle', 0, 'Rotation in degrees for MANUAL (added to clock modes).'),
];

export const MODULE_TYPES = ['RootLayerModule', 'StackLayerModule', 'OverlapLayerModule', 'TextModule', 'ShapeModule', 'BitmapModule', 'FontIconModule'] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const SCHEMA: Record<ModuleType, { desc: string; sections: Section[] }> = {
  RootLayerModule: {
    desc: 'The wallpaper itself: a screen-sized layer. Children are placed by anchor + offset.',
    sections: [
      {
        name: 'background',
        props: [
          p('background_type', 'enum', 'SOLID', 'SOLID colour or wallpaper IMAGE.', ENUMS.backgroundType),
          p('background_color', 'color', '#FF333333', 'Background colour (also behind images).'),
          p('background_bitmap', 'bitmap', '', 'Wallpaper image when background_type is IMAGE.'),
          p('background_scroll', 'enum', 'NORMAL', 'Whether a wide image pans with the home screens.', ENUMS.backgroundScroll),
          p('background_blur', 'number', 0, 'Background blur (not previewed).'),
          p('background_dim', 'percent', 0, 'Background dimming (not previewed).'),
        ],
      },
      { name: 'layer', props: [p('config_scale_value', 'number', 100, 'Scale (%) applied to every size in the preset.')] },
      { name: 'position', props: POSITION.props.filter((d) => d.key.startsWith('position_padding')) },
    ],
  },
  StackLayerModule: {
    desc: 'Lays children out in a row or column with config_margin between them (like Android LinearLayout).',
    sections: [layerSection(true), POSITION],
  },
  OverlapLayerModule: {
    desc: 'Stacks children on top of each other; each child is placed by its own position_anchor. Sized to its largest child.',
    sections: [layerSection(false), POSITION],
  },
  TextModule: {
    desc: 'Text, usually driven by formulas such as $df(hh:mm)$.',
    sections: [
      {
        name: 'text',
        props: [
          p('text_expression', 'formula', '$df(hh:mm)$', 'The text. Literal text plus $formula$ blocks.'),
          p('text_family', 'font', '', 'Font file (empty = Roboto).'),
          p('text_size_type', 'enum', 'SINGLE_FONT_HEIGHT',
            'SINGLE_FONT_HEIGHT: text_size is the font size. FIXED_WIDTH: wraps at text_width. SINGLE_FIXED_WIDTH: scaled to fill text_width. FIT_TO_BOX: largest size fitting text_width x text_height.', ENUMS.fontSize),
          p('text_size', 'number', 20, 'Font size in units (SINGLE_FONT_HEIGHT and FIXED_WIDTH).'),
          p('text_width', 'number', 200, 'Box width in units (all modes except SINGLE_FONT_HEIGHT).'),
          p('text_height', 'number', 200, 'Box height in units (FIT_TO_BOX).'),
          p('text_lines', 'number', 0, 'Max lines for FIXED_WIDTH (0 = unlimited).'),
          p('text_align', 'enum', 'LEFT', 'Alignment of multiple lines.', ENUMS.textAlign),
          ...rotateProps('text'),
        ],
      },
      PAINT,
      FX,
      POSITION,
    ],
  },
  ShapeModule: {
    desc: 'Geometric shape.',
    sections: [
      {
        name: 'shape',
        props: [
          p('shape_type', 'enum', 'SQUARE', 'Shape kind. SQUARE/CIRCLE/EXAGON/SQUIRCLE use shape_width for both sides; SLICE is a ring segment (progress rings); ARC is a bar bent along shape_angle.', ENUMS.shape),
          p('shape_width', 'number', 20, 'Width in units (SLICE: ring diameter; ARC: length of the bent bar).'),
          p('shape_height', 'number', 20, 'Height in units (RECT, OVAL, TRIANGLE, RTRIANGLE, PATH); ring/bar thickness for SLICE and ARC.'),
          p('shape_corners', 'number', 0, 'Corner radius in units.'),
          p('shape_angle', 'angle', 45, 'Sweep in degrees for SLICE (clockwise from 12 o\'clock) and ARC; e.g. $bi(level) * 3.6$ for a battery ring.'),
          p('shape_path', 'formula', 'C0,0 25,50 0,100 L 100,50 L 0,0 Z', 'SVG path data for PATH, in a 100x100 box.'),
          p('shape_path_scale', 'enum', 'AUTO', 'Path scaling.', ENUMS.pathScale),
          ...rotateProps('shape'),
        ],
      },
      PAINT,
      FX,
      POSITION,
    ],
  },
  BitmapModule: {
    desc: 'Image (PNG/JPG/WebP in BITMAP mode, SVG in VECTOR mode). Height follows the image aspect ratio for FIT_WIDTH.',
    sections: [
      {
        name: 'bitmap',
        props: [
          p('bitmap_mode', 'enum', 'BITMAP', 'BITMAP for raster images, VECTOR for SVG.', ENUMS.bitmapMode),
          p('bitmap_bitmap', 'bitmap', '', 'Raster image (also accepts a formula such as $mi(cover)$).'),
          p('bitmap_svg', 'bitmap', '', 'SVG image used in VECTOR mode.'),
          p('bitmap_scale_mode', 'enum', 'FIT_WIDTH', 'FIT_WIDTH keeps the aspect ratio from bitmap_width.', ENUMS.bitmapScale),
          p('bitmap_width', 'number', 100, 'Width in units.'),
          p('bitmap_height', 'number', 100, 'Height in units (FIT_HEIGHT, CENTER_FIT, CENTER_CROP).'),
          p('bitmap_alpha', 'percent', 100, 'Opacity (0..100).'),
          p('bitmap_blur', 'number', 0, 'Blur radius in px.'),
          p('bitmap_dim', 'percent', 0, 'Darken (not previewed).'),
          p('bitmap_filter', 'enum', 'NONE', 'Colour filter (not previewed).', ENUMS.colorFilter),
          p('bitmap_rmode', 'enum', 'NONE', 'Rotation mode.', ENUMS.rotate),
          p('bitmap_rotate', 'angle', 0, 'Rotation in degrees for MANUAL.'),
        ],
      },
      POSITION,
    ],
  },
  FontIconModule: {
    desc: 'Icon glyph from an icon font (icons/*.ttf with a matching IcoMoon .json listing icon names).',
    sections: [
      {
        name: 'icon',
        props: [
          p('icon_set', 'iconset', '', 'Icon font, e.g. kfile://org.kustom.provider/icons/material.ttf.'),
          p('icon_icon', 'icon', 'star', 'Icon name inside the set (see `klwp icons`).'),
          p('icon_size', 'number', 80, 'Icon box size in units.'),
          p('icon_color_mode', 'enum', 'DEFAULT', 'How multicolour icons are tinted.', ENUMS.iconColor),
          ...rotateProps('icon'),
        ],
      },
      PAINT,
      FX,
      POSITION,
    ],
  },
};

const INDEX = new Map<string, Map<string, PropDef>>(
  Object.entries(SCHEMA).map(([t, s]) => [t, new Map(s.sections.flatMap((sec) => sec.props).map((d) => [d.key, d]))]),
);

export function propDef(type: string, key: string): PropDef | undefined {
  return INDEX.get(type)?.get(key);
}

export function moduleProps(type: string): PropDef[] {
  return [...(INDEX.get(type)?.values() ?? [])];
}

export function isModuleType(t: string): t is ModuleType {
  return (MODULE_TYPES as readonly string[]).includes(t);
}

export function isLayerType(t: string): boolean {
  return t === 'RootLayerModule' || t === 'StackLayerModule' || t === 'OverlapLayerModule' || t === 'KomponentModule';
}

/** Spec default for a property. Root children's anchor defaults to TOP (KEnvType.getDefaultAnchor). */
export function moduleDefault(type: string, key: string, onRoot = false): unknown {
  if (key === 'position_anchor') return onRoot ? 'TOP' : 'CENTER';
  return INDEX.get(type)?.get(key)?.default ?? (type === 'KomponentModule' ? INDEX.get('OverlapLayerModule')?.get(key)?.default : undefined);
}

export const COLOR_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Validates a literal value for a property; returns an error message or null. */
export function checkValue(def: PropDef, v: unknown): string | null {
  switch (def.type) {
    case 'number':
    case 'percent':
    case 'angle':
      return typeof v === 'number' && isFinite(v) ? null : `${def.key} must be a number`;
    case 'color':
      return typeof v === 'string' && COLOR_RE.test(v) ? null : `${def.key} must be a colour like #FFRRGGBB`;
    case 'enum':
      return typeof v === 'string' && def.values!.includes(v) ? null : `${def.key} must be one of ${def.values!.join(', ')}`;
    default:
      return typeof v === 'string' ? null : `${def.key} must be a string`;
  }
}
