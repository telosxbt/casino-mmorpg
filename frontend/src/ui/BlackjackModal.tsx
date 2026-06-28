import { useEffect, useState } from 'react';
import { Modal, field } from './Modal';
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
    <span style={{ display: 'inline-block', minWidth: 30, padding: '6px 4px', margin: 2, background: '#fff', color: red ? '#c0202a' : '#111', borderRadius: 5, textAlign: 'center', fontWeight: 700 }}>
      {RANK(c.r)}{SUIT[c.s]}
    </span>
  );
}

export function BlackjackModal({ table, onClose }: { table: Interactable; onClose: () => void }) {
  const { decimals } = useGame();
  const token = useSession((s) => s.tokens?.accessToken)!;
  const selfId = useSession((s) => s.tokens?.user)!;
  const [state, setState] = useState('WAITING');
  const [bettingEndsAt, setBettingEndsAt] = useState(0);
  const [bet, setBet] = useState('1');
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
      setSeats([]); setResults(null); setTurnUser(null);
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
  const act = (action: string) => connect('blackjack', token).emit('blackjack:action', { tableId: table.id, action });
  const placeBet = () => {
    setErr(null);
    connect('blackjack', token).emit('blackjack:bet', { tableId: table.id, amount: toBase(bet, decimals).toString() });
  };

  if (full) {
    return (
      <Modal title={`🃏 ${table.label}`} onClose={onClose}>
        <p style={{ color: '#e04b4b', fontWeight: 700 }}>Table Full — try the other blackjack table.</p>
      </Modal>
    );
  }

  const countdown = state === 'WAITING' ? Math.max(0, Math.round((bettingEndsAt - Date.now()) / 1000)) : 0;

  return (
    <Modal title={`🃏 ${table.label}`} onClose={onClose} width={520}>
      <div style={{ marginBottom: 10, color: '#99a', fontSize: 13 }}>
        {state === 'WAITING' ? `Place your bet — ${countdown}s` : state.replace('_', ' ')}
      </div>

      <div style={section}>
        <div style={label}>Dealer</div>
        <div>
          {dealer.length ? dealer.map((c, i) => <CardView key={i} c={c} />) : dealerUp ? (<><CardView c={dealerUp} /><span style={hidden}>🂠</span></>) : '—'}
        </div>
      </div>

      <div style={section}>
        <div style={label}>Players</div>
        {seats.length === 0 && <div style={{ color: '#667' }}>No hands yet.</div>}
        {seats.map((seat) => (
          <div key={seat.userId} style={{ marginBottom: 6, outline: turnUser === seat.userId ? '2px solid #e0c84b' : 'none', borderRadius: 6, padding: 2 }}>
            <span style={{ fontSize: 12, color: seat.userId === selfId ? '#7ad' : '#da7', marginRight: 6 }}>
              {seat.username}{seat.userId === selfId ? ' (you)' : ''} · {seat.value}
            </span>
            {seat.cards?.map((c: Card, i: number) => <CardView key={i} c={c} />)}
          </div>
        ))}
      </div>

      {results && (
        <div style={{ ...section, color: '#4be07a' }}>
          {results.map((r) => (
            <div key={r.userId} style={{ fontSize: 13 }}>
              {r.userId === selfId ? 'You' : r.userId.slice(0, 6)}: {r.result} {Number(r.payout) > 0 ? `(+${fromBase(r.payout, decimals)})` : ''}
            </div>
          ))}
        </div>
      )}

      {state === 'WAITING' ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input style={field} value={bet} onChange={(e) => setBet(e.target.value)} />
          <button style={actBtn} onClick={placeBet}>Bet</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={actBtn} disabled={!myTurn} onClick={() => act('hit')}>Hit</button>
          <button style={actBtn} disabled={!myTurn} onClick={() => act('stand')}>Stand</button>
          <button style={actBtn} disabled={!myTurn} onClick={() => act('double')}>Double</button>
        </div>
      )}
      {err && <p style={{ color: '#f55' }}>{err}</p>}
    </Modal>
  );
}

const section: React.CSSProperties = { background: '#10101a', borderRadius: 8, padding: 10, marginBottom: 10 };
const label: React.CSSProperties = { fontSize: 11, color: '#778', marginBottom: 6, textTransform: 'uppercase' };
const hidden: React.CSSProperties = { display: 'inline-block', fontSize: 28, margin: 2, color: '#446' };
const actBtn: React.CSSProperties = { flex: 1, background: '#3a3a5a', color: '#fff', border: 0, padding: '10px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
