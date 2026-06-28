import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { depositToBankroll } from '../lib/solana';
import { useGame } from '../store';
import { fromBase, toBase } from '../lib/format';

export function WalletModal({ onClose }: { onClose: () => void }) {
  const { balance, decimals, depositAddress, setWallet } = useGame();
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txs, setTxs] = useState<any[]>([]);

  useEffect(() => { api.transactions().then(setTxs).catch(() => {}); }, []);

  async function deposit() {
    setErr(null); setMsg(null); setBusy('deposit');
    try {
      const sig = await depositToBankroll(toBase(amount, decimals), decimals);
      const res = await api.deposit(sig);
      setWallet({ balance: res.balance, decimals, depositAddress });
      setMsg(`Deposited ${fromBase(res.credited, decimals)} 🪙`);
      api.transactions().then(setTxs).catch(() => {});
    } catch (e: any) { setErr(e.message ?? 'deposit failed'); } finally { setBusy(null); }
  }

  async function withdraw() {
    setErr(null); setMsg(null); setBusy('withdraw');
    try {
      await api.withdraw(toBase(amount, decimals).toString());
      const b = await api.balance(); setWallet(b);
      setMsg('Withdrawal queued — tokens will arrive shortly.');
      api.transactions().then(setTxs).catch(() => {});
    } catch (e: any) { setErr(e.message ?? 'withdraw failed'); } finally { setBusy(null); }
  }

  return (
    <Modal title="Wallet" onClose={onClose} width={440}>
      <div className="cz-box" style={{ margin: '0 auto 14px', maxWidth: 260 }}>
        <div className="cz-box-label">BALANCE</div>
        <div className="cz-box-val" style={{ fontSize: 24 }}>{fromBase(balance, decimals)} 🪙</div>
      </div>

      <div style={{ fontSize: 11, letterSpacing: 2, color: '#e9cf8e', marginBottom: 4 }}>AMOUNT</div>
      <input className="cz-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="cz-row" style={{ marginTop: 12 }}>
        <button className="cz-btn" disabled={!!busy} onClick={deposit}>{busy === 'deposit' ? '…' : 'Deposit'}</button>
        <button className="cz-btn cz-btn--dark" disabled={!!busy} onClick={withdraw}>{busy === 'withdraw' ? '…' : 'Withdraw'}</button>
      </div>

      {msg && <div className="cz-win" style={{ marginTop: 10, color: '#9ff0bd' }}>{msg}</div>}
      {err && <div className="cz-err">{err}</div>}

      <div className="cz-note">
        Deposits go on-chain to the bankroll and are verified by the backend before crediting.
        <br />Bankroll: {depositAddress || '—'}
      </div>

      {txs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: '#e9cf8e', marginBottom: 6 }}>RECENT</div>
          {txs.slice(0, 8).map((t) => (
            <div key={t.id} style={{ fontSize: 12, color: '#e9cf8ecc', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>{t.type}</span>
              <span>{fromBase(t.amount, decimals)}</span>
              <span style={{ color: t.status === 'CONFIRMED' ? '#9ff0bd' : t.status === 'FAILED' ? '#ff8a8a' : '#ffe07a' }}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
