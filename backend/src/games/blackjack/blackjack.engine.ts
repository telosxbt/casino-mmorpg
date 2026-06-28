// Pure blackjack rules. No state/IO. The shoe is shuffled from the fairness
// stream by the service; this file only builds/evaluates cards and hands.

export interface Card {
  r: number; // 1=Ace, 2..10, 11=J, 12=Q, 13=K
  s: 'S' | 'H' | 'D' | 'C';
}

const SUITS: Card['s'][] = ['S', 'H', 'D', 'C'];

/** One ordered deck (caller shuffles via the fair RNG). */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) cards.push({ r, s });
  return cards;
}

/** Multi-deck shoe. */
export function buildShoe(decks = 6): Card[] {
  const shoe: Card[] = [];
  for (let i = 0; i < decks; i++) shoe.push(...buildDeck());
  return shoe;
}

function cardValue(c: Card): number {
  if (c.r === 1) return 11; // ace, adjusted below
  return Math.min(c.r, 10);
}

/** Best hand total accounting for soft aces. */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.r === 1) aces++;
  }
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  soft = aces > 0 && total <= 21;
  return { total, soft };
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** Dealer draws to 17 and stands on all 17s (including soft 17). */
export function dealerShouldHit(cards: Card[]): boolean {
  return handValue(cards).total < 17;
}

export type Outcome = 'WIN' | 'LOSE' | 'PUSH' | 'BLACKJACK';

/** Settle one player hand vs the dealer. */
export function outcome(player: Card[], dealer: Card[]): Outcome {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  const pBj = isBlackjack(player);
  const dBj = isBlackjack(dealer);
  if (pBj && dBj) return 'PUSH';
  if (pBj) return 'BLACKJACK';
  if (dBj) return 'LOSE';
  if (p > 21) return 'LOSE';
  if (d > 21) return 'WIN';
  if (p > d) return 'WIN';
  if (p < d) return 'LOSE';
  return 'PUSH';
}

/** Total return (stake + profit) for an outcome. Blackjack pays 3:2. */
export function payoutFor(outcomeKind: Outcome, bet: bigint): bigint {
  switch (outcomeKind) {
    case 'BLACKJACK':
      return bet + (bet * 3n) / 2n; // 2.5x return
    case 'WIN':
      return bet * 2n;
    case 'PUSH':
      return bet; // stake returned
    case 'LOSE':
      return 0n;
  }
}
