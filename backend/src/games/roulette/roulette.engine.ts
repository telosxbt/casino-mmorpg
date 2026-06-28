// Pure European single-zero roulette logic (0–36). No state, no I/O — fully
// unit-testable and shared by the service. Outcomes come from the fairness
// stream; this file only classifies numbers and evaluates bets.

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type Color = 'red' | 'black' | 'green';

export function colorOf(n: number): Color {
  if (n === 0) return 'green';
  return RED.has(n) ? 'red' : 'black';
}

export type BetType =
  | 'straight'
  | 'red'
  | 'black'
  | 'even'
  | 'odd'
  | 'low'
  | 'high'
  | 'dozen'
  | 'column';

// Profit multiplier on a win (excludes the returned stake).
const MULTIPLIER: Record<BetType, number> = {
  straight: 35,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
  dozen: 2,
  column: 2,
};

export interface Selection {
  number?: number; // straight
  dozen?: 1 | 2 | 3; // dozen
  column?: 1 | 2 | 3; // column
}

/** Validate a bet's selection for its type. Returns false if malformed. */
export function isValidBet(type: BetType, sel: Selection): boolean {
  switch (type) {
    case 'straight':
      return Number.isInteger(sel.number) && sel.number! >= 0 && sel.number! <= 36;
    case 'dozen':
      return sel.dozen === 1 || sel.dozen === 2 || sel.dozen === 3;
    case 'column':
      return sel.column === 1 || sel.column === 2 || sel.column === 3;
    case 'red':
    case 'black':
    case 'even':
    case 'odd':
    case 'low':
    case 'high':
      return true;
    default:
      return false;
  }
}

/** Does this bet win against `result`? */
export function wins(type: BetType, sel: Selection, result: number): boolean {
  if (result === 0) return type === 'straight' && sel.number === 0;
  switch (type) {
    case 'straight':
      return sel.number === result;
    case 'red':
      return colorOf(result) === 'red';
    case 'black':
      return colorOf(result) === 'black';
    case 'even':
      return result % 2 === 0;
    case 'odd':
      return result % 2 === 1;
    case 'low':
      return result >= 1 && result <= 18;
    case 'high':
      return result >= 19 && result <= 36;
    case 'dozen':
      return Math.ceil(result / 12) === sel.dozen;
    case 'column':
      return result % 3 === (sel.column === 3 ? 0 : sel.column);
    default:
      return false;
  }
}

/** Total return (stake + profit) for a winning bet, or 0n if it loses. */
export function settle(type: BetType, sel: Selection, amount: bigint, result: number): bigint {
  return wins(type, sel, result) ? amount * BigInt(MULTIPLIER[type] + 1) : 0n;
}
