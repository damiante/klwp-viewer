import { describe, expect, it } from 'vitest';
import { type FormulaContext, evaluateText, evaluateValue } from '../src/klwp/formula';
import { createFunctions, defaultDeviceState, formatDate } from '../src/klwp/functions';

// Thursday 23 October 2025, 17:29:05
const now = new Date(2025, 9, 23, 17, 29, 5);

function ctx(globals: Record<string, string> = {}): FormulaContext {
  const state = defaultDeviceState(now);
  const warnings: string[] = [];
  return {
    functions: createFunctions({ state, global: (n) => globals[n] }),
    warn: (m) => warnings.push(m),
  };
}

describe('formula engine', () => {
  it('keeps literal text and evaluates $ blocks', () => {
    expect(evaluateText('Battery $bi(level)$%', ctx())).toBe('Battery 76%');
    expect(evaluateText('cost $$5', ctx())).toBe('cost $5');
  });

  it('follows KLWP operator precedence and number formatting', () => {
    const c = ctx();
    expect(evaluateText('$1 + 2 * 3$', c)).toBe('7');
    expect(evaluateText('$-2 ^ 2$', c)).toBe('4');
    expect(evaluateText('$10 / 4$', c)).toBe('2.5');
    expect(evaluateText('$1/3$', c)).toBe('0.33333');
    expect(evaluateText('$100 - mi(percent)$', c)).toBe('61');
  });

  it('treats non-numeric operands as text, like the app', () => {
    const c = ctx();
    expect(evaluateText('$df(dd/MM/yyyy)$', c)).toBe('23/10/2025');
    expect(evaluateText('$a + b$', c)).toBe('ab');
    expect(evaluateValue('$gv(gold-1)$', ctx({ 'gold-1': '#FFD3BC5F' }))).toBe('#FFD3BC5F');
  });

  it('evaluates the expressions used by the sample presets', () => {
    const c = ctx();
    expect(evaluateText('$df(EEEE)$, $df(d)$$tc(ord,df(d))$ $df(MMMM)$', c)).toBe('Thursday, 23rd October');
    expect(evaluateText('$df(HH:mm)$', c)).toBe('17:29');
    expect(evaluateText('$df(hh:mm)$', c)).toBe('05:29');
    expect(evaluateText('$wi(temp)$°$wi(tempu)$', c)).toBe('21°C');
    expect(evaluateText('$tc(cap, wi(cond))$', c)).toBe('Partly Cloudy');
    expect(evaluateText('$tf(mi(pos), mm:ss)$ - $tf(mi(len), mm:ss)$', c)).toBe('01:35 - 04:04');
    expect(evaluateText('$if(mi(state)!=PLAYING, play, pause)$', c)).toBe('pause');
    expect(evaluateText('$if(mi(state)=PLAYING,pause,play_arrow)$', c)).toBe('pause');
    expect(evaluateValue('$if(si(darkmode), #FF000000, #FFFFFFFF)$', c)).toBe('#FFFFFFFF');
    expect(evaluateText('$if(ai(isday), day, night)$', c)).toBe('day');
  });

  it('supports if/else-if chains and quoted strings', () => {
    const c = ctx();
    expect(evaluateText('$if(0, a, 0, b, c)$', c)).toBe('c');
    expect(evaluateText('$if(1, "x, y (z)", b)$', c)).toBe('x, y (z)');
    expect(evaluateText('$tc(up, "hello world")$', c)).toBe('HELLO WORLD');
  });

  it('returns empty text for malformed expressions instead of throwing', () => {
    expect(evaluateText('a$if(1,$b', ctx())).toBe('ab');
    expect(evaluateText('$(1+$', ctx())).toBe('');
  });
});

describe('formatDate', () => {
  it('handles Joda-style patterns and quoted text', () => {
    expect(formatDate(now, "EEE d MMM yyyy 'at' h:mma")).toBe('Thu 23 Oct 2025 at 5:29PM');
    expect(formatDate(now, 'D w e')).toBe('296 43 4');
  });
});
