import { colorOf, settle, wins, isValidBet } from '../src/games/roulette/roulette.engine';

describe('roulette engine', () => {
  it('classifies colours correctly', () => {
    expect(colorOf(0)).toBe('green');
    expect(colorOf(1)).toBe('red');
    expect(colorOf(2)).toBe('black');
    expect(colorOf(36)).toBe('red');
  });

  it('zero loses all outside bets', () => {
    for (const t of ['red', 'black', 'even', 'odd', 'low', 'high'] as const) {
      expect(wins(t, {}, 0)).toBe(false);
    }
    expect(wins('straight', { number: 0 }, 0)).toBe(true);
  });

  it('pays straight 35:1 (36x total return)', () => {
    expect(settle('straight', { number: 17 }, 10n, 17)).toBe(360n);
    expect(settle('straight', { number: 17 }, 10n, 18)).toBe(0n);
  });

  it('pays even-money outside bets 1:1 (2x total)', () => {
    expect(settle('red', {}, 10n, 1)).toBe(20n);
    expect(settle('red', {}, 10n, 2)).toBe(0n);
  });

  it('pays dozens and columns 2:1 (3x total)', () => {
    expect(settle('dozen', { dozen: 1 }, 10n, 5)).toBe(30n);
    expect(settle('dozen', { dozen: 1 }, 10n, 13)).toBe(0n);
    expect(settle('column', { column: 1 }, 10n, 1)).toBe(30n);
    expect(settle('column', { column: 3 }, 10n, 3)).toBe(30n);
  });

  it('rejects malformed selections', () => {
    expect(isValidBet('straight', { number: 37 })).toBe(false);
    expect(isValidBet('dozen', { dozen: 4 as any })).toBe(false);
    expect(isValidBet('red', {})).toBe(true);
  });
});
