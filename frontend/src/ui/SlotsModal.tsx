import { useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useGame, type Interactable } from '../store';
import { fromBase, toBase } from '../lib/format';

const ICON: Record<string, string> = {
  '7': '7️⃣', BAR: '🍫', BELL: '🔔', PLUM: '🍇', ORANGE: '🍊', LEMON: '🍋', CHERRY: '🍒',
};

export function SlotsModal({ machine, onClose }: { machine: Interactable; onClose: () => void }) {
  const { decimals, balance, setBalance } = useGame();
  const [bet, setBet] = useState(100);
  const [reels, setReels] = useState<string[]>(['7', 'CHERRY', 'BELL']);
  const [spinning, setSpinning] = useState(false);
  const [win, setWin] = useState<{ payout: string; multiplier: number; fairness: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function spin() {
    setErr(null);
    setWin(null);
    setSpinning(true);
    try {
      const res = await api.slotsSpin(machine.id, toBase(String(bet), decimals).toString());
      // brief spin animation before revealing
      await new Promise((r) => setTimeout(r, 600));
      setReels(res.result);
      setWin({ payout: res.payout, multiplier: res.multiplier, fairness: res.fairness });
      setBalance(res.balance);
    } catch (e: any) {
      setErr(e.message ?? 'spin failed');
    } finally {
      setSpinning(false);
    }
  }

  return (
    <Modal title="Slot Machine" onClose={onClose} width={420}>
      <div className="cz-box" style={{ margin: '0 auto 12px', maxWidth: 220 }}>
        <div className="cz-box-label">✦ JACKPOT ✦</div>
        <div className="cz-box-val" style={{ fontSize: 24 }}>{fromBase(balance, decimals)} 🪙</div>
      </div>

      <div className={`cz-reels`}>
        {reels.map((r, i) => (
          <div key={i} className={`cz-reel ${spinning ? 'spin' : ''}`}>{ICON[r] ?? r}</div>
        ))}
      </div>

      <div className="cz-row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <div className="cz-box">
          <div className="cz-box-label">BET</div>
          <div className="cz-row" style={{ gap: 8 }}>
            <button className="cz-btn cz-btn--dark" style={{ padding: '2px 10px' }} onClick={() => setBet((b) => Math.max(1, b - 50))}>◀</button>
            <span className="cz-box-val">{bet}</span>
            <button className="cz-btn cz-btn--dark" style={{ padding: '2px 10px' }} onClick={() => setBet((b) => b + 50)}>▶</button>
          </div>
        </div>
        <button className="cz-btn" style={{ fontSize: 22, padding: '14px 28px' }} disabled={spinning} onClick={spin}>
          {spinning ? '…' : 'SPIN'}
        </button>
        <div className="cz-box">
          <div className="cz-box-label">WIN</div>
          <div className="cz-box-val" style={{ color: win && Number(win.payout) > 0 ? '#ffe07a' : undefined }}>
            {win ? fromBase(win.payout, decimals) : 0}
          </div>
        </div>
      </div>

      {win && Number(win.payout) > 0 && <div className="cz-win" style={{ marginTop: 12, fontSize: 18 }}>WIN ×{win.multiplier}! 🎉</div>}
      {err && <div className="cz-err">{err}</div>}
      {win?.fairness && (
        <div className="cz-note">
          Provably fair · hash {win.fairness.serverSeedHash?.slice(0, 12)}… · seed {win.fairness.serverSeed?.slice(0, 12)}…
        </div>
      )}
    </Modal>
  );
}
