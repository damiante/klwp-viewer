// KLWP formula engine. Mirrors the app's Javaluator setup (org.kustom.lib.parser.e):
// text outside $...$ is literal; inside, literals are split only at operators, brackets
// and commas, so barewords like `MMMM d` or `#FF000000` survive as plain strings.

export type Value = string | number;

export type FormulaFn = (args: Value[], ctx: FormulaContext) => Value;

export interface FormulaContext {
  functions: Record<string, FormulaFn>;
  /** Local variables (e.g. `index` inside series formulas). */
  vars?: Record<string, Value>;
  /** Collects unknown functions / parse errors for diagnostics. */
  warn?: (msg: string) => void;
}

type Token =
  | { t: 'lit'; v: string; quoted: boolean }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: '(' }
  | { t: ')' }
  | { t: ',' };

// Precedences from org.kustom.lib.parser.e: & | =1, comparisons =2, + - =3, * / % =4, ^ =5, unary - =6.
const BINARY: Record<string, number> = {
  '&': 1, '|': 1,
  '=': 2, '!=': 2, '>': 2, '>=': 2, '<': 2, '<=': 2, '~=': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4, '%': 4,
  '^': 5,
};
const TWO_CHAR = ['>=', '<=', '!=', '~='];
const ONE_CHAR = '=><+-*/%^&|';

export function isNumeric(s: string): boolean {
  return /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(s);
}

/** Converts like operators.q.g(): numeric strings become numbers. */
function toNum(v: Value): Value {
  return typeof v === 'string' && isNumeric(v) ? parseFloat(v) : v;
}

/** Number formatting used when a formula result is written into text. */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n % 1 === 0) return String(Math.trunc(n));
  // parser.i.b.e(): doubles are floored to 5 decimals before printing.
  const f = Math.floor(n * 100000) / 100000;
  return String(parseFloat(f.toFixed(5)));
}

export function valueToString(v: Value): string {
  return typeof v === 'number' ? formatNumber(v) : v;
}

export function truthy(v: Value): boolean {
  const s = valueToString(v);
  return s.length > 0 && s !== '0';
}

function tokenize(src: string, ctx: FormulaContext): Token[] {
  const out: Token[] = [];
  let buf = '';
  let quoted = false;
  let wasQuoted = false;
  const flush = () => {
    const s = wasQuoted ? buf : buf.trim();
    if (s.length > 0 || wasQuoted) out.push({ t: 'lit', v: s, quoted: wasQuoted });
    buf = '';
    wasQuoted = false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      if (quoted) {
        quoted = false;
        flush();
      } else {
        if (buf.trim()) flush();
        buf = '';
        quoted = true;
        wasQuoted = true;
      }
      continue;
    }
    if (quoted) {
      buf += c;
      continue;
    }
    // Javaluator comments: /* ... */
    if (c === '/' && src[i + 1] === '*') {
      flush();
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.includes(two)) {
      flush();
      out.push({ t: 'op', v: two });
      i++;
    } else if (ONE_CHAR.includes(c)) {
      flush();
      out.push({ t: 'op', v: c });
    } else if (c === '(') {
      flush();
      const last = out[out.length - 1];
      if (last && last.t === 'lit' && !last.quoted && /^[a-z]\w*$/i.test(last.v)) {
        const name = last.v.toLowerCase();
        if (!ctx.functions[name]) ctx.warn?.(`Unknown function ${name}()`);
        out[out.length - 1] = { t: 'fn', v: name };
      }
      out.push({ t: '(' });
    } else if (c === ')') {
      flush();
      out.push({ t: ')' });
    } else if (c === ',') {
      flush();
      out.push({ t: ',' });
    } else {
      buf += c;
    }
  }
  if (quoted) wasQuoted = true;
  flush();
  return out;
}

class Parser {
  private pos = 0;
  constructor(private toks: Token[], private ctx: FormulaContext) {}

  parse(): Value {
    if (this.toks.length === 0) return '';
    const v = this.expr(0);
    if (this.pos < this.toks.length) throw new Error('Unexpected token');
    return v;
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private expr(minPrec: number): Value {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') break;
      const prec = BINARY[t.v];
      if (prec === undefined || prec < minPrec) break;
      this.pos++;
      const right = this.expr(prec + 1);
      left = applyBinary(t.v, left, right);
    }
    return left;
  }

  private unary(): Value {
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '-') {
      this.pos++;
      const v = toNum(this.unary());
      return typeof v === 'number' ? -v : '-' + v;
    }
    return this.primary();
  }

  private primary(): Value {
    const t = this.toks[this.pos++];
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'lit') {
      const local = this.ctx.vars?.[t.v.toLowerCase()];
      return local !== undefined ? local : t.v;
    }
    if (t.t === '(') {
      const v = this.expr(0);
      this.expect(')');
      return v;
    }
    if (t.t === 'fn') {
      this.expect('(');
      const args: Value[] = [];
      if (this.peek()?.t === ')') {
        this.pos++;
      } else {
        for (;;) {
          args.push(this.expr(0));
          const n = this.toks[this.pos++];
          if (!n) throw new Error('Unclosed function');
          if (n.t === ')') break;
          if (n.t !== ',') throw new Error('Expected ,');
        }
      }
      const fn = this.ctx.functions[t.v];
      if (!fn) return '';
      try {
        return fn(args, this.ctx);
      } catch (e) {
        this.ctx.warn?.(`${t.v}(): ${(e as Error).message}`);
        return '';
      }
    }
    throw new Error(`Unexpected ${t.t}`);
  }

  private expect(type: '(' | ')') {
    const t = this.toks[this.pos++];
    if (!t || t.t !== type) throw new Error(`Expected ${type}`);
  }
}

function applyBinary(op: string, a0: Value, b0: Value): Value {
  const a = toNum(a0);
  const b = toNum(b0);
  const nums = typeof a === 'number' && typeof b === 'number';
  switch (op) {
    case '=':
      return equals(a, b) ? 1 : 0;
    case '!=':
      return equals(a, b) ? 0 : 1;
    case '~=':
      try {
        return new RegExp(String(b)).test(String(a)) ? 1 : 0;
      } catch {
        return 0;
      }
    case '+':
      // operators.o: numeric add, otherwise plain concatenation
      return nums ? (a as number) + (b as number) : valueToString(a) + valueToString(b);
  }
  // Every other operator concatenates "a op b" when an operand is not numeric (operators.q.e).
  if (!nums) return valueToString(a) + op + valueToString(b);
  const x = a as number;
  const y = b as number;
  switch (op) {
    case '-': return x - y;
    case '*': return x * y;
    case '/': return x / y;
    case '%': return x % y;
    case '^': return Math.pow(x, y);
    case '>': return x > y ? 1 : 0;
    case '>=': return x >= y ? 1 : 0;
    case '<': return x < y ? 1 : 0;
    case '<=': return x <= y ? 1 : 0;
    case '&': return x === 1 && y === 1 ? 1 : 0;
    case '|': return x === 1 || y === 1 ? 1 : 0;
  }
  return '';
}

function equals(a: Value, b: Value): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return valueToString(a).trim().toLowerCase() === valueToString(b).trim().toLowerCase();
}

/** Evaluates the body of one $...$ block. Errors yield "" like the app. */
export function evaluateExpression(src: string, ctx: FormulaContext): Value {
  try {
    return new Parser(tokenize(src, ctx), ctx).parse();
  } catch (e) {
    ctx.warn?.(`Invalid expression "${src}": ${(e as Error).message}`);
    return '';
  }
}

/** Splits text into literal and $expression$ segments (parser.i.w()). */
export function splitSegments(text: string): { expr: boolean; s: string }[] {
  const out: { expr: boolean; s: string }[] = [];
  let buf = '';
  let inExpr = false;
  let inQuote = false;
  for (const c of text) {
    if (c === '"' && inExpr) inQuote = !inQuote;
    if (c !== '$' || inQuote) {
      buf += c;
      continue;
    }
    if (inExpr) {
      out.push(buf.length === 0 ? { expr: false, s: '$' } : { expr: true, s: buf });
    } else if (buf.length > 0) {
      out.push({ expr: false, s: buf });
    }
    buf = '';
    inExpr = !inExpr;
  }
  // An unterminated $ block is kept as plain text.
  if (buf.length > 0) out.push({ expr: false, s: inExpr ? '$' + buf : buf });
  return out;
}

/** Evaluates a full KLWP text/formula string to its display string. */
export function evaluateText(text: string, ctx: FormulaContext): string {
  let out = '';
  for (const seg of splitSegments(text)) {
    out += seg.expr ? valueToString(evaluateExpression(seg.s, ctx)) : seg.s;
  }
  return out;
}

/** Evaluates a formula keeping a single expression's raw type (used for numeric properties). */
export function evaluateValue(text: string, ctx: FormulaContext): Value {
  const segs = splitSegments(text);
  if (segs.length === 1 && segs[0].expr) return evaluateExpression(segs[0].s, ctx);
  return evaluateText(text, ctx);
}
