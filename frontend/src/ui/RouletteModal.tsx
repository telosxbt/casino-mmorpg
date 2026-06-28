import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { connect } from '../lib/socket';
import { api } from '../lib/api';
import { useGame, useSession } from '../store';
import { fromBase, toBase } from '../lib/format';

type Phase = 'BETTING' | 'SPINNING' | 'SETTLED';
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorClass = (n: number) => (n === 0 ? 'cz-rl-green' : RED.has(n) ? 'cz-rl-red' : 'cz-rl-black');
const CHIPS: { v: number; c: string }[] = [
  { v: 10, c: '#c0c0c0' }, { v: 50, c: '#d23b3b' }, { v: 100, c: '#2f6fd2' },
  { v: 500, c: '#2faa5a' }, { v: 1000, c: '#7a4fd2' }, { v: 5000, c: '#caa23a' },
];

export function RouletteModal({ lobbyId, name, onClose }: { lobbyId: string; name: string; onClose: () => void }) {
  const { decimals, balance } = useGame();
  const token = useSession((s) => s.tokens?.accessToken)!;
  const [phase, setPhase] = useState<Phase>('BETTING');
  const [countdown, setCountdown] = useState(0);
  const [seats, setSeats] = useState(0);
  const [chip, setChip] = useState(100);
  const [staked, setStaked] = useState(0);
  const [last, setLast] = useState<{ result: number; color: string } | null>(null);
  const [fairness, setFairness] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = connect('roulette', token);
    s.emit('roulette:join', { lobbyId });
    s.on('roulette:joined', (d: any) => setSeats(d.seats));
    s.on('roulette:error', (d: any) => setErr(d.reason));
    s.on('roulette:state', (d: any) => {
      setPhase('BETTING'); setStaked(0); setLast(null); setFairness(null); setErr(null);
      setSeats(d.seats); setCountdown(Math.max(0, Math.round((d.bettingEndsAt - Date.now()) / 1000)));
    });
    s.on('roulette:spin', (d: any) => { setPhase('SPINNING'); setLast({ result: d.result, color: d.color }); });
    s.on('roulette:result', (d: any) => {
      setPhase('SETTLED'); setLast({ result: d.result, color: d.color }); setFairness(d.fairness);
      api.balance().then((b) => useGame.getState().setWallet(b)).catch(() => {});
    });
    return () => {
      s.emit('roulette:leave');
      connect('lobby', token).emit('lobby:leave', { id: lobbyId });
      ['roulette:joined','roulette:error','roulette:state','roulette:spin','roulette:result'].forEach((e) => s.off(e));
    };
  }, [lobbyId, token]);

  useEffect(() => {
    if (phase !== 'BETTING' || countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [phase, countdown]);

  function place(type: string, selection: object = {}) {
    if (phase !== 'BETTING') return;
    setErr(null);
    connect('roulette', token).emit('roulette:bet', { lobbyId, type, selection, amount: toBase(String(chip), decimals).toString() });
    setStaked((s) => s + chip);
  }

  const cols = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <Modal title={`🎡 ${name}`} onClose={onClose} width={680}>
      <div className="cz-row" style={{ alignItems: 'stretch', gap: 14 }}>
        <div className={`cz-wheel ${phase === 'SPINNING' ? 'spin' : ''}`}>
          <div className="cz-wheel-hub" />
          {last && phase !== 'SPINNING' && <div className="cz-wheel-num" style={{ color: last.color === 'red' ? '#ff6b6b' : last.color === 'green' ? '#7bf3a6' : '#fff' }}>{last.result}</div>}
        </div>
        <div className="cz-felt" style={{ flex: 1, padding: 10 }}>
          {/* number grid */}
          <div className="cz-rl-grid">
            <div className={`cz-rl-cell cz-rl-green cz-rl-zero`} style={{ gridColumn: 1, gridRow: '1 / span 3' }} onClick={() => place('straight', { number: 0 })}>0</div>
            {cols.map((c) => (
              <Cell key={`t${c}`} n={c * 3} col={c + 1} row={1} place={place} />
            ))}
            {cols.map((c) => (
              <Cell key={`m${c}`} n={c * 3 - 1} col={c + 1} row={2} place={place} />
            ))}
            {cols.map((c) => (
              <Cell key={`b${c}`} n={c * 3 - 2} col={c + 1} row={3} place={place} />
            ))}
            <div className="cz-rl-cell cz-rl-out" style={{ gridColumn: 14, gridRow: 1 }} onClick={() => place('column', { column: 3 })}>2:1</div>
            <div className="cz-rl-cell cz-rl-out" style={{ gridColumn: 14, gridRow: 2 }} onClick={() => place('column', { column: 2 })}>2:1</div>
            <div className="cz-rl-cell cz-rl-out" style={{ gridColumn: 14, gridRow: 3 }} onClick={() => place('column', { column: 1 })}>2:1</div>
          </div>
          {/* dozens */}
          <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(3,1fr) 44px', gap: 3, marginTop: 3 }}>
            <div />
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('dozen', { dozen: 1 })}>1st 12</div>
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('dozen', { dozen: 2 })}>2nd 12</div>
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('dozen', { dozen: 3 })}>3rd 12</div>
            <div />
          </div>
          {/* outside */}
          <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(6,1fr) 44px', gap: 3, marginTop: 3 }}>
            <div />
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('low')}>1-18</div>
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('even')}>EVEN</div>
            <div className="cz-rl-cell cz-rl-red" onClick={() => place('red')}>◆</div>
            <div className="cz-rl-cell cz-rl-black" onClick={() => place('black')}>◆</div>
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('odd')}>ODD</div>
            <div className="cz-rl-cell cz-rl-out" onClick={() => place('high')}>19-36</div>
            <div />
          </div>
        </div>
      </div>

      <div className="cz-row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <div className="cz-box"><div className="cz-box-label">BALANCE</div><div className="cz-box-val">{fromBase(balance, decimals)}</div></div>
        <div className="cz-box"><div className="cz-box-label">STAKED</div><div className="cz-box-val">{staked}</div></div>
        <div className="cz-box" style={{ minWidth: 130 }}>
          <div className="cz-box-label">{phase === 'BETTING' ? `BETTING · ${countdown}s` : phase === 'SPINNING' ? 'SPINNING…' : 'RESULT'}</div>
          <div className="cz-box-val">{phase === 'BETTING' ? '🎯' : last ? last.result : '—'}</div>
        </div>
        <div className="cz-box"><div className="cz-box-label">SEATS</div><div className="cz-box-val">{seats}/8</div></div>
      </div>

      <div className="cz-row" style={{ marginTop: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: 2, color: '#e9cf8e' }}>CHOOSE CHIP</span>
        {CHIPS.map((c) => (
          <button key={c.v} className="cz-chip" data-on={chip === c.v} style={{ color: c.c }} onClick={() => setChip(c.v)}>
            {c.v >= 1000 ? `${c.v / 1000}K` : c.v}
          </button>
        ))}
      </div>

      {err && <div className="cz-err">{err}</div>}
      {fairness && <div className="cz-note">Provably fair · hash {fairness.serverSeedHash?.slice(0, 12)}… · seed {fairness.serverSeed?.slice(0, 12)}…</div>}
    </Modal>
  );
}

function Cell({ n, col, row, place }: { n: number; col: number; row: number; place: (t: string, s?: object) => void }) {
  return (
    <div className={`cz-rl-cell ${colorClass(n)}`} style={{ gridColumn: col, gridRow: row }} onClick={() => place('straight', { number: n })}>
      {n}
    </div>
  );
}
