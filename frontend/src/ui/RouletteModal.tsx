import { useEffect, useState } from 'react';
import { Modal, field, fairnessNote } from './Modal';
import { connect } from '../lib/socket';
import { api } from '../lib/api';
import { useGame, useSession, type Interactable } from '../store';
import { fromBase, toBase } from '../lib/format';

type Phase = 'BETTING' | 'SPINNING' | 'SETTLED';
const OUTSIDE = ['red', 'black', 'even', 'odd', 'low', 'high'] as const;

export function RouletteModal({ table, onClose }: { table: Interactable; onClose: () => void }) {
  const { decimals } = useGame();
  const token = useSession((s) => s.tokens?.accessToken)!;
  const [phase, setPhase] = useState<Phase>('BETTING');
  const [countdown, setCountdown] = useState(0);
  const [seats, setSeats] = useState(0);
  const [full, setFull] = useState(false);
  const [bet, setBet] = useState('1');
  const [myBets, setMyBets] = useState<string[]>([]);
  const [last, setLast] = useState<{ result: number; color: string } | null>(null);
  const [fairness, setFairness] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = connect('roulette', token);
    s.emit('roulette:join', { tableId: table.id });
    s.on('roulette:full', () => setFull(true));
    s.on('roulette:joined', (d: any) => setSeats(d.seats));
    s.on('roulette:seats', (d: any) => setSeats(d.seats));
    s.on('roulette:error', (d: any) => setErr(d.reason));
    s.on('roulette:state', (d: any) => {
      setPhase('BETTING');
      setMyBets([]);
      setLast(null);
      setFairness(null);
      setSeats(d.seats);
      setCountdown(Math.max(0, Math.round((d.bettingEndsAt - Date.now()) / 1000)));
    });
    s.on('roulette:spin', (d: any) => {
      setPhase('SPINNING');
      setLast({ result: d.result, color: d.color });
    });
    s.on('roulette:result', (d: any) => {
      setPhase('SETTLED');
      setLast({ result: d.result, color: d.color });
      setFairness(d.fairness);
      api.balance().then((b) => useGame.getState().setWallet(b)).catch(() => {});
    });
    return () => {
      s.emit('roulette:leave');
      s.off('roulette:full');
      s.off('roulette:joined');
      s.off('roulette:seats');
      s.off('roulette:error');
      s.off('roulette:state');
      s.off('roulette:spin');
      s.off('roulette:result');
    };
  }, [table.id, token]);

  useEffect(() => {
    if (phase !== 'BETTING' || countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [phase, countdown]);

  function place(type: string, selection: object = {}) {
    setErr(null);
    const amount = toBase(bet, decimals).toString();
    connect('roulette', token).emit('roulette:bet', { tableId: table.id, type, selection, amount });
    setMyBets((b) => [...b, `${type} ${JSON.stringify(selection) !== '{}' ? JSON.stringify(selection) : ''} (${bet})`]);
  }

  if (full) {
    return (
      <Modal title={`🎡 ${table.label}`} onClose={onClose}>
        <p style={{ color: '#e04b4b', fontWeight: 700 }}>Table Full — try another roulette table.</p>
      </Modal>
    );
  }

  const colorHex = last?.color === 'red' ? '#e04b4b' : last?.color === 'green' ? '#4be07a' : '#222';

  return (
    <Modal title={`🎡 ${table.label}`} onClose={onClose} width={520}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: colorHex, display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800, border: '3px solid #444' }}>
          {last ? last.result : '—'}
        </div>
        <div>
          <div style={{ fontWeight: 700 }}>
            {phase === 'BETTING' ? `Betting — ${countdown}s` : phase === 'SPINNING' ? 'Spinning…' : 'Result'}
          </div>
          <div style={{ fontSize: 12, color: '#99a' }}>Seats {seats}/8</div>
        </div>
      </div>

      <label style={{ fontSize: 12, color: '#99a' }}>Chip size</label>
      <input style={{ ...field, margin: '4px 0 12px' }} value={bet} onChange={(e) => setBet(e.target.value)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {OUTSIDE.map((o) => (
          <button key={o} disabled={phase !== 'BETTING'} style={chipBtn(o)} onClick={() => place(o)}>
            {o.toUpperCase()}
          </button>
        ))}
        {[1, 2, 3].map((d) => (
          <button key={`dz${d}`} disabled={phase !== 'BETTING'} style={chipBtn('')} onClick={() => place('dozen', { dozen: d })}>
            DOZEN {d}
          </button>
        ))}
        {[1, 2, 3].map((c) => (
          <button key={`col${c}`} disabled={phase !== 'BETTING'} style={chipBtn('')} onClick={() => place('column', { column: c })}>
            COL {c}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <StraightGrid disabled={phase !== 'BETTING'} onPick={(n) => place('straight', { number: n })} />
      </div>

      {myBets.length > 0 && (
        <div style={{ fontSize: 12, color: '#99a', marginTop: 10 }}>This round: {myBets.join(', ')}</div>
      )}
      {err && <p style={{ color: '#f55' }}>{err}</p>}
      {fairness && (
        <div style={fairnessNote}>
          Provably fair — hash {fairness.serverSeedHash?.slice(0, 16)}… seed {fairness.serverSeed?.slice(0, 16)}…
        </div>
      )}
    </Modal>
  );
}

function StraightGrid({ onPick, disabled }: { onPick: (n: number) => void; disabled: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 2 }}>
      {Array.from({ length: 37 }, (_, n) => (
        <button key={n} disabled={disabled} onClick={() => onPick(n)}
          style={{ fontSize: 11, padding: '4px 0', background: '#1c1c2a', color: '#fff', border: '1px solid #2a2a3a', borderRadius: 4, cursor: 'pointer' }}>
          {n}
        </button>
      ))}
    </div>
  );
}

const chipBtn = (o: string): React.CSSProperties => ({
  padding: '8px 0',
  background: o === 'red' ? '#e04b4b' : o === 'black' ? '#333' : '#3a3a5a',
  color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
});
