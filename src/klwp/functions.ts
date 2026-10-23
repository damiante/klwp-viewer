// Built-in KLWP functions, backed by a simulated device state since a browser has no
// battery/weather/music providers. Names and argument shapes follow org.kustom.lib.parser.functions.

import { type FormulaFn, type Value, isNumeric, truthy, valueToString } from './formula';

export interface DeviceState {
  now: Date;
  darkMode: boolean;
  battery: { level: number; charging: boolean; temp: number };
  weather: { temp: number; unit: 'C' | 'F'; cond: string; humidity: number; wind: number; code: string };
  music: {
    state: 'PLAYING' | 'PAUSED' | 'STOPPED';
    title: string;
    artist: string;
    album: string;
    /** position / length in seconds */
    pos: number;
    len: number;
    cover: string;
  };
  sunrise: Date;
  sunset: Date;
  locale: string;
}

export function defaultDeviceState(now = new Date()): DeviceState {
  const day = (h: number, m: number) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  };
  return {
    now,
    darkMode: false,
    battery: { level: 76, charging: false, temp: 31 },
    weather: { temp: 21, unit: 'C', cond: 'partly cloudy', humidity: 54, wind: 12, code: 'PARTLY_CLOUDY' },
    music: {
      state: 'PLAYING',
      title: 'Midnight City',
      artist: 'M83',
      album: "Hurry Up, We're Dreaming",
      pos: 95,
      len: 244,
      cover: '',
    },
    sunrise: day(6, 42),
    sunset: day(19, 18),
    locale: 'en-US',
  };
}

const pad = (n: number, w: number) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime() - (d.getTimezoneOffset() - start.getTimezoneOffset()) * 60000) / 86400000);
}

function weekOfYear(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Joda/SimpleDateFormat-style pattern formatting, plus KLWP's `e`/`f`/`D`/`w` letters. */
export function formatDate(d: Date, pattern: string, locale = 'en-US'): string {
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    const c = pattern[i];
    if (c === "'") {
      const end = pattern.indexOf("'", i + 1);
      if (end === i + 1) {
        out += "'";
        i += 2;
        continue;
      }
      out += pattern.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    if (!/[a-zA-Z]/.test(c)) {
      out += c;
      i++;
      continue;
    }
    let n = 1;
    while (pattern[i + n] === c) n++;
    i += n;
    const h = d.getHours();
    switch (c) {
      case 'y':
      case 'Y':
        out += n === 2 ? pad(d.getFullYear() % 100, 2) : pad(d.getFullYear(), n);
        break;
      case 'M':
        if (n >= 4) out += d.toLocaleString(locale, { month: 'long' });
        else if (n === 3) out += d.toLocaleString(locale, { month: 'short' });
        else out += pad(d.getMonth() + 1, n);
        break;
      case 'L':
        out += pad(d.getMonth() + 1, n);
        break;
      case 'd':
        out += pad(d.getDate(), n);
        break;
      case 'D':
        out += pad(dayOfYear(d), n);
        break;
      case 'w':
        out += pad(weekOfYear(d), n);
        break;
      case 'E':
        out += d.toLocaleString(locale, { weekday: n >= 4 ? 'long' : 'short' });
        break;
      case 'e':
      case 'f':
        // KLWP: day of week number, Monday = 1
        out += pad(d.getDay() === 0 ? 7 : d.getDay(), n);
        break;
      case 'a':
        out += h < 12 ? 'AM' : 'PM';
        break;
      case 'H':
        out += pad(h, n);
        break;
      case 'k':
        out += pad(h === 0 ? 24 : h, n);
        break;
      case 'K':
        out += pad(h % 12, n);
        break;
      case 'h':
        out += pad(h % 12 === 0 ? 12 : h % 12, n);
        break;
      case 'm':
        out += pad(d.getMinutes(), n);
        break;
      case 's':
        out += pad(d.getSeconds(), n);
        break;
      case 'S':
        out += pad(d.getMilliseconds(), 3).slice(0, n);
        break;
      case 'z':
      case 'Z': {
        const off = -d.getTimezoneOffset();
        out += (off >= 0 ? '+' : '-') + pad(off / 60, 2) + (c === 'z' ? ':' : '') + pad(off % 60, 2);
        break;
      }
      default:
        out += c.repeat(n);
    }
  }
  return out;
}

/** Applies KLWP date modifiers such as `a1d`, `r2h`, `a30m` to a base date. */
export function shiftDate(base: Date, spec: string): Date {
  const d = new Date(base);
  const re = /([ar])(\d+)([smhdMwy])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec))) {
    const n = parseInt(m[2], 10) * (m[1] === 'a' ? 1 : -1);
    switch (m[3]) {
      case 's': d.setSeconds(d.getSeconds() + n); break;
      case 'm': d.setMinutes(d.getMinutes() + n); break;
      case 'h': d.setHours(d.getHours() + n); break;
      case 'd': d.setDate(d.getDate() + n); break;
      case 'w': d.setDate(d.getDate() + n * 7); break;
      case 'M': d.setMonth(d.getMonth() + n); break;
      case 'y': d.setFullYear(d.getFullYear() + n); break;
    }
  }
  return d;
}

function toDate(v: Value | undefined, state: DeviceState): Date {
  if (v === undefined || v === '') return state.now;
  if (typeof v === 'number' || isNumeric(v)) return new Date(Number(v) * 1000);
  return shiftDate(state.now, v);
}

/** Duration formatting for tf(): seconds -> pattern with h/m/s letters. */
function formatDuration(totalSeconds: number, pattern?: string): string {
  const neg = totalSeconds < 0;
  let s = Math.abs(Math.round(totalSeconds));
  if (!pattern) {
    if (s < 60) return `${s} seconds`;
    if (s < 3600) return `${Math.round(s / 60)} minutes`;
    return `${Math.round(s / 3600)} hours`;
  }
  const hasH = /[hH]/.test(pattern);
  const hasM = /m/.test(pattern);
  const H = hasH ? Math.floor(s / 3600) : 0;
  s -= H * 3600;
  const M = hasM ? Math.floor(s / 60) : 0;
  s -= M * 60;
  const out = pattern.replace(/([hHms])\1*/g, (tok) => {
    const n = tok.length;
    if (tok[0] === 'h' || tok[0] === 'H') return pad(H, n);
    if (tok[0] === 'm') return pad(M, n);
    return pad(s, n);
  });
  return (neg ? '-' : '') + out;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberToWords(n: number): string {
  if (n < 0) return 'minus ' + numberToWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
  if (n < 1e6) return numberToWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberToWords(n % 1000) : '');
  return String(n);
}

function ordinal(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

function roman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

const str = (v: Value | undefined) => (v === undefined ? '' : valueToString(v));
const num = (v: Value | undefined) => (v === undefined || v === '' ? 0 : Number(v));
const key = (v: Value | undefined) => str(v).trim().toLowerCase();

function textFn(args: Value[]): Value {
  const mode = key(args[0]);
  const text = str(args[1]);
  switch (mode) {
    case 'low': return text.toLowerCase();
    case 'up': return text.toUpperCase();
    case 'cap': return text.replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());
    case 'cut': {
      const a = num(args[2]);
      const b = args[3] === undefined ? undefined : num(args[3]);
      if (b === undefined) return a >= 0 ? text.slice(0, a) : text.slice(a);
      return text.substr(a, b);
    }
    case 'ell': {
      const n = num(args[2]);
      return text.length > n ? text.slice(0, n) + '…' : text;
    }
    case 'len': return text.length;
    case 'count': return str(args[2]) ? text.split(str(args[2])).length - 1 : 0;
    case 'ord': return ordinal(Math.trunc(num(args[1])));
    case 'n2w': return numberToWords(Math.trunc(num(args[1])));
    case 'roman': return text.replace(/\d+/g, (d) => roman(parseInt(d, 10)));
    case 'lpad': return text.padStart(num(args[2]), str(args[3] ?? '0') || '0');
    case 'rpad': return text.padEnd(num(args[2]), str(args[3] ?? '0') || '0');
    case 'reg':
      try {
        return text.replace(new RegExp(str(args[2]), 'g'), str(args[3]));
      } catch {
        return text;
      }
    case 'split': {
      const parts = text.split(str(args[2]));
      return parts[num(args[3])] ?? '';
    }
    case 'lines': return text.split('\n').length;
    case 'utf': return String.fromCodePoint(parseInt(text, 16));
    case 'url': return encodeURIComponent(text);
    case 'html': return text.replace(/<[^>]*>/g, '');
    case 'nfmt': return text.replace(/\d+(\.\d+)?/g, (d) => Number(d).toLocaleString('en-US'));
  }
  return text;
}

function mathFn(args: Value[]): Value {
  const fn = key(args[0]);
  const a = args.slice(1).map(num);
  const r: Record<string, () => number> = {
    round: () => (a.length > 1 ? Number(a[0].toFixed(a[1])) : Math.round(a[0])),
    floor: () => Math.floor(a[0]),
    ceil: () => Math.ceil(a[0]),
    abs: () => Math.abs(a[0]),
    min: () => Math.min(...a),
    max: () => Math.max(...a),
    sqrt: () => Math.sqrt(a[0]),
    pow: () => Math.pow(a[0], a[1]),
    log: () => Math.log10(a[0]),
    ln: () => Math.log(a[0]),
    sin: () => Math.sin((a[0] * Math.PI) / 180),
    cos: () => Math.cos((a[0] * Math.PI) / 180),
    tan: () => Math.tan((a[0] * Math.PI) / 180),
    asin: () => (Math.asin(a[0]) * 180) / Math.PI,
    acos: () => (Math.acos(a[0]) * 180) / Math.PI,
    atan: () => (Math.atan(a[0]) * 180) / Math.PI,
    rnd: () => Math.floor(a[0] + Math.random() * (a[1] - a[0] + 1)),
    h2d: () => parseInt(str(args[1]), 16),
    d2h: () => a[0],
  };
  if (fn === 'd2h') return Math.trunc(a[0]).toString(16);
  return r[fn] ? r[fn]() : '';
}

export interface FunctionHost {
  state: DeviceState;
  /** Global value lookup for gv(). */
  global(name: string): Value | undefined;
}

export function createFunctions(host: FunctionHost): Record<string, FormulaFn> {
  const s = () => host.state;
  const unsupported: FormulaFn = () => '';
  return {
    if: (args) => {
      // h0: if(c1, v1, c2, v2, ..., else)
      let i = 0;
      while (i + 1 < args.length) {
        if (truthy(args[i])) return args[i + 1];
        i += 2;
      }
      return i < args.length ? args[i] : '';
    },
    df: (args) => formatDate(toDate(args[1], s()), str(args[0]), s().locale),
    dp: (args) => Math.floor(toDate(args[0], s()).getTime() / 1000),
    tf: (args) => {
      const v = args[0];
      if (typeof v === 'number' || isNumeric(str(v))) return formatDuration(num(v), args[1] === undefined ? undefined : str(args[1]));
      const d = toDate(v, s());
      return formatDuration((d.getTime() - s().now.getTime()) / 1000, args[1] === undefined ? undefined : str(args[1]));
    },
    tc: (args) => textFn(args),
    mu: (args) => mathFn(args),
    gv: (args) => {
      const name = str(args[0]).trim();
      return host.global(name) ?? host.global(name.replace(/\.0$/, '')) ?? '';
    },
    bi: (args) => {
      const b = s().battery;
      switch (key(args[0])) {
        case 'level': return b.level;
        case 'charging': return b.charging ? 1 : 0;
        case 'plugged': return b.charging ? 1 : 0;
        case 'temp': return b.temp;
        case 'tempc': return b.temp;
        case 'volt': return 4100;
        case 'source': return b.charging ? 'USB' : 'Battery';
      }
      return '';
    },
    wi: (args) => {
      const w = s().weather;
      switch (key(args[0])) {
        case 'temp': return w.temp;
        case 'tempu': return w.unit;
        case 'flik': return w.temp - 1;
        case 'cond': return w.cond;
        case 'code': return w.code;
        case 'icon': return w.code;
        case 'hum': return w.humidity;
        case 'wspeed': return w.wind;
        case 'wspeedu': return 'km/h';
        case 'wdir': return 'NW';
        case 'clouds': return 40;
        case 'uvindex': return 4;
        case 'press': return 1015;
      }
      return '';
    },
    mi: (args) => {
      const m = s().music;
      switch (key(args[0])) {
        case 'title': return m.title;
        case 'artist': return m.artist;
        case 'album': return m.album;
        case 'state': return m.state;
        case 'len': return m.len;
        case 'pos': return m.pos;
        case 'percent': return m.len ? Math.round((m.pos / m.len) * 100) : 0;
        case 'cover': return m.cover;
        case 'package': return 'com.spotify.music';
        case 'vol': return 60;
      }
      return '';
    },
    si: (args) => {
      switch (key(args[0])) {
        case 'darkmode': return s().darkMode ? 1 : 0;
        case 'locked': return 0;
        case 'screen': return 1;
        case 'land': return 0;
        case 'alarmd': return '';
        case 'boot': return 0;
      }
      return '';
    },
    ai: (args) => {
      const st = s();
      switch (key(args[0])) {
        case 'isday': return st.now >= st.sunrise && st.now < st.sunset ? 1 : 0;
        case 'sunrise': return Math.floor(st.sunrise.getTime() / 1000);
        case 'sunset': return Math.floor(st.sunset.getTime() / 1000);
        case 'nsunrise': return Math.floor(st.sunrise.getTime() / 1000) + 86400;
        case 'nsunset': return Math.floor(st.sunset.getTime() / 1000);
        case 'mphase': return 'Waxing Gibbous';
        case 'mill': return 72;
        case 'zodiac': return 'Libra';
      }
      return '';
    },
    // Providers that need real device data render empty.
    nc: unsupported,
    ni: unsupported,
    ci: unsupported,
    li: unsupported,
    wf: unsupported,
    wg: unsupported,
    br: unsupported,
    aq: unsupported,
    cm: unsupported,
    ce: unsupported,
    bp: unsupported,
    rm: unsupported,
    sh: unsupported,
    tu: unsupported,
    uc: unsupported,
    fd: unsupported,
    gh: unsupported,
    mq: unsupported,
    lv: unsupported,
    fl: unsupported,
  };
}
