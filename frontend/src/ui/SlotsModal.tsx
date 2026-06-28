import { useState } from 'react';
import { Modal, field, action, fairnessNote } from './Modal';
import { api } from '../lib/api';
import { useGame, type Interactable } from '../store';
import { fromBase, toBase } from '../lib/format';

const ICON: Record<string, string> = {
  '7': '7️⃣', BAR: '🍫', BELL: '🔔', PLUM: '🍇', ORANGE: '🍊', LEMON: '🍋', CHERRY: '🍒',
};

export function SlotsModal({ machine, onClose }: { machine: Interactable; onClose: () => void }) {
  const { decimals, balance, setBalance } = useGame();
  const [bet, setBet] = useState('1');
  const [reels, setReels] = useState<string[]>(['7', '7', '7']);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ payout: string; multiplier: number; fairness: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function spin() {
    setErr(null);
    setResult(null);
    setSpinning(true);
    try {
      const res = await api.slotsSpin(machine.id, toBase(bet, decimals).toString());
      setReels(res.result);
      setResult({ payout: res.payout, multiplier: res.multiplier, fairness: res.fairness });
      setBalance(res.balance);
    } catch (e: any) {
      setErr(e.message ?? 'spin failed');
    } finally {
      setSpinning(false);
    }
  }

  return (
    <Modal title={`🎰 ${machine.label}`} onClose={onClose} width={380}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, fontSize: 56, margin: '8px 0 16px' }}>
        {reels.map((r, i) => (
          <span key={i} style={{ filter: spinning ? 'blur(2px)' : 'none' }}>
            {ICON[r] ?? r}
          </span>
        ))}
      </div>

      {result && (
        <div style={{ textAlign: 'center', marginBottom: 12, color: Number(result.payout) > 0 ? '#4be07a' : '#888' }}>
          {Number(result.payout) > 0 ? `WIN ×${result.multiplier} → ${fromBase(result.payout, decimals)} 🪙` : 'No win'}
        </div>
      )}

      <label style={{ fontSize: 12, color: '#99a' }}>Bet (balance {fromBase(balance, decimals)})</label>
      <input style={{ ...field, margin: '4px 0 12px' }} value={bet} onChange={(e) => setBet(e.target.value)} />
      <button style={{ ...action, width: '100%' }} disabled={spinning} onClick={spin}>
        {spinning ? 'Spinning…' : 'SPIN'}
      </button>
      {err && <p style={{ color: '#f55' }}>{err}</p>}
      {result?.fairness && (
        <div style={fairnessNote}>
          Provably fair — seed hash {result.fairness.serverSeedHash?.slice(0, 16)}… revealed seed{' '}
          {result.fairness.serverSeed?.slice(0, 16)}…
        </div>
      )}
    </Modal>
  );
}
