import {
  buildShoe,
  handValue,
  isBlackjack,
  dealerShouldHit,
  outcome,
  payoutFor,
  Card,
} from '../src/games/blackjack/blackjack.engine';

const c = (r: number, s: Card['s'] = 'S'): Card => ({ r, s });

describe('blackjack engine', () => {
  it('builds a 6-deck shoe of 312 cards', () => {
    expect(buildShoe(6)).toHaveLength(312);
  });

  it('counts soft and hard aces', () => {
    expect(handValue([c(1), c(13)]).total).toBe(21); // A + K
    expect(handValue([c(1), c(1), c(9)]).total).toBe(21); // A + A + 9 => 11+1+9
    expect(handValue([c(10), c(10), c(2)]).total).toBe(22); // bust
    expect(handValue([c(1), c(6)]).soft).toBe(true);
  });

  it('detects naturals', () => {
    expect(isBlackjack([c(1), c(12)])).toBe(true);
    expect(isBlackjack([c(5), c(6), c(10)])).toBe(false);
  });

  it('dealer hits below 17, stands on 17+', () => {
    expect(dealerShouldHit([c(10), c(6)])).toBe(true); // 16
    expect(dealerShouldHit([c(10), c(7)])).toBe(false); // 17
    expect(dealerShouldHit([c(1), c(6)])).toBe(false); // soft 17 => stand
  });

  it('resolves outcomes and pays correctly', () => {
    expect(outcome([c(1), c(13)], [c(10), c(9)])).toBe('BLACKJACK');
    expect(payoutFor('BLACKJACK', 10n)).toBe(25n); // 2.5x
    expect(outcome([c(10), c(9)], [c(10), c(7)])).toBe('WIN');
    expect(payoutFor('WIN', 10n)).toBe(20n);
    expect(outcome([c(10), c(7)], [c(10), c(7)])).toBe('PUSH');
    expect(payoutFor('PUSH', 10n)).toBe(10n);
    expect(outcome([c(10), c(5)], [c(10), c(8)])).toBe('LOSE');
    expect(payoutFor('LOSE', 10n)).toBe(0n);
    expect(outcome([c(10), c(10), c(5)], [c(10), c(7)])).toBe('LOSE'); // player bust
  });
});
