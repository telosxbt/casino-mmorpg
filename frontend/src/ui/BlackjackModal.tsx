import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { connect } from '../lib/socket';
import { api } from '../lib/api';
import { useGame, useSession, type Interactable } from '../store';
import { fromBase, toBase } from '../lib/format';

interface Card { r: number; s: string }
const RANK = (r: number) => (r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : `${r}`);
const SUIT: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

function CardView({ c }: { c: Card }) {
  const red = c.s === 'H' || c.s === 'D';
  return (
    <div className={`cz-card ${red ? 'red' : ''}`}>
      <span className="cz-card-tl">{RANK(c.r)}{SUIT[c.s]}</span>
      <span>{SUIT[c.s]}</span>
      <span className="cz-card-tr">{RANK(c.r)}{SUIT[c.s]}</span>
    </div>
  );
}
const Back = () => <div className="cz-card back" />;

export function BlackjackModal({ table, onClose }: { table: Interactable; onClose: () => void }) {
  const { decimals } = useGame();
  const token = useSession((s) => s.tokens?.accessToken)!;
  const selfId = useSession((s) => s.tokens?.user)!;
  const [state, setState] = useState('WAITING');
  const [bettingEndsAt, setBettingEndsAt] = useState(0);
  const [bet, setBet] = useState(100);
  const [full, setFull] = useState(false);
  const [dealer, setDealer] = useState<Card[]>([]);
  const [dealerUp, setDealerUp] = useState<Card | null>(null);
  const [seats, setSeats] = useState<any[]>([]);
  const [turnUser, setTurnUser] = useState<string | null>(null);
  const [results, setResults] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = connect('blackjack', token);
    s.emit('blackjack:join', { tableId: table.id });
    s.on('blackjack:full', () => setFull(true));
    s.on('blackjack:error', (d: any) => setErr(d.reason));
    s.on('blackjack:state', (d: any) => {
      setState(d.state); setBettingEndsAt(d.bettingEndsAt); setDealer([]); setDealerUp(null);
      setSeats([]); setResults(null); setTurnUser(null); setErr(null);
    });
    s.on('blackjack:deal', (d: any) => { setState('PLAYER_TURNS'); setDealerUp(d.dealerUp); setSeats(d.seats); });
    s.on('blackjack:hand', (seat: any) => setSeats((prev) => prev.map((x) => (x.userId === seat.userId ? seat : x))));
    s.on('blackjack:turn', (d: any) => setTurnUser(d.userId));
    s.on('blackjack:dealer', (d: any) => { setState('DEALER_TURN'); setDealer(d.dealer); setTurnUser(null); });
    s.on('blackjack:result', (d: any) => {
      setState('SETTLED'); setDealer(d.dealer); setResults(d.results);
      api.balance().then((b) => useGame.getState().setWallet(b)).catch(() => {});
    });
    return () => {
      s.emit('blackjack:leave');
      ['blackjack:full','blackjack:error','blackjack:state','blackjack:deal','blackjack:hand','blackjack:turn','blackjack:dealer','blackjack:result'].forEach((e) => s.off(e));
    };
  }, [table.id, token]);

  const myTurn = turnUser === selfId;
  const me = seats.find((x) => x.userId === selfId);
  const others = seats.filter((x) => x.userId !== selfId);
  const act = (action: string) => connect('blackjack', token).emit('blackjack:action', { tableId: table.id, action });
  const placeBet = () => { setErr(null); connect('blackjack', token).emit('blackjack:bet', { tableId: table.id, amount: toBase(String(bet), decimals).toString() }); };
  const dealerValue = dealer.length ? handVal(dealer) : dealerUp ? handVal([dealerUp]) : 0;
  const myResult = results?.find((r) => r.userId === selfId);

  if (full) {
    return (
      <Modal title="Blackjack" onClose={onClose}>
        <div className="cz-felt" style={{ textAlign: 'center', padding: 28 }}>
          <div className="cz-win" style={{ color: '#ff8a8a' }}>TABLE FULL</div>
          <div style={{ color: '#cdebd6', marginTop: 8 }}>Try the other blackjack table.</div>
        </div>
      </Modal>
    );
  }

  const countdown = state === 'WAITING' ? Math.max(0, Math.round((bettingEndsAt - Date.now()) / 1000)) : 0;

  return (
    <Modal title="Blackjack" onClose={onClose} width={560}>
      <div className="cz-felt">
        {/* Dealer */}
        <div className="cz-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={feltLabel}>DEALER</div>
            <div className="cz-row" style={{ justifyContent: 'flex-start', minHeight: 70 }}>
              {dealer.length ? dealer.map((c, i) => <CardView key={i} c={c} />)
                : dealerUp ? <><CardView c={dealerUp} /><Back /></>
                : <span style={{ color: '#cdebd6' }}>—</span>}
            </div>
          </div>
          <div className="cz-box"><div className="cz-box-label">DEALER</div><div className="cz-box-val">{state === 'PLAYER_TURNS' && !dealer.length ? '?' : dealerValue || '—'}</div></div>
        </div>

        <div style={{ textAlign: 'center', color: '#bfe6cd', letterSpacing: 2, fontSize: 12, margin: '8px 0' }}>
          ❖ BLACKJACK PAYS 3 TO 2 ❖
        </div>

        {/* Player (you) */}
        <div className="cz-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={feltLabel}>PLAYER {myTurn && <span style={{ color: '#ffe07a' }}>● your turn</span>}</div>
            <div className="cz-row" style={{ justifyContent: 'flex-start', minHeight: 70 }}>
              {me?.cards?.length ? me.cards.map((c: Card, i: number) => <CardView key={i} c={c} />) : <span style={{ color: '#cdebd6' }}>—</span>}
            </div>
          </div>
          <div className="cz-box"><div className="cz-box-label">PLAYER</div><div className="cz-box-val">{me ? me.value : '—'}</div></div>
        </div>

        {others.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {others.map((o) => (
              <div key={o.userId} style={{ fontSize: 11, color: '#bfe6cd', outline: turnUser === o.userId ? '2px solid #ffe07a' : 'none', borderRadius: 6, padding: 3 }}>
                {o.username} · {o.value}
                <div className="cz-row" style={{ justifyContent: 'flex-start', transform: 'scale(.7)', transformOrigin: 'left' }}>
                  {o.cards?.map((c: Card, i: number) => <CardView key={i} c={c} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {myResult && (
        <div className="cz-win" style={{ marginTop: 12, fontSize: 18 }}>
          {myResult.result}{Number(myResult.payout) > 0 ? ` · +${fromBase(myResult.payout, decimals)} 🪙` : ''}
        </div>
      )}

      <div className="cz-row" style={{ marginTop: 14, justifyContent: 'center' }}>
        {state === 'WAITING' ? (
          <>
            <div className="cz-box">
              <div className="cz-box-label">BET — {countdown}s</div>
              <div className="cz-row" style={{ gap: 8 }}>
                <button className="cz-btn cz-btn--dark" style={{ padding: '2px 10px' }} onClick={() => setBet((b) => Math.max(1, b - 50))}>◀</button>
                <span className="cz-box-val">{bet}</span>
                <button className="cz-btn cz-btn--dark" style={{ padding: '2px 10px' }} onClick={() => setBet((b) => b + 50)}>▶</button>
              </div>
            </div>
            <button className="cz-btn" onClick={placeBet}>Deal</button>
          </>
        ) : (
          <>
            <button className="cz-btn" disabled={!myTurn} onClick={() => act('hit')}>👆 Hit</button>
            <button className="cz-btn" disabled={!myTurn} onClick={() => act('stand')}>✋ Stand</button>
            <button className="cz-btn cz-btn--dark" disabled={!myTurn} onClick={() => act('double')}>Double</button>
          </>
        )}
      </div>
      {err && <div className="cz-err">{err}</div>}
    </Modal>
  );
}

// Local hand value (display only; server is authoritative).
function handVal(cards: Card[]): number {
  let total = 0, aces = 0;
  for (const c of cards) { total += c.r === 1 ? 11 : Math.min(c.r, 10); if (c.r === 1) aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const feltLabel: React.CSSProperties = { fontSize: 11, letterSpacing: 2, color: '#bfe6cd', marginBottom: 4 };
