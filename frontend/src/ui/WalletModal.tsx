import { useEffect, useState } from 'react';
import { Modal, field, action } from './Modal';
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

  useEffect(() => {
    api.transactions().then(setTxs).catch(() => {});
  }, []);

  async function deposit() {
    setErr(null); setMsg(null); setBusy('deposit');
    try {
      const sig = await depositToBankroll(toBase(amount, decimals), decimals);
      const res = await api.deposit(sig);
      setWallet({ balance: res.balance, decimals, depositAddress });
      setMsg(`Deposited ${fromBase(res.credited, decimals)} 🪙`);
      api.transactions().then(setTxs).catch(() => {});
    } catch (e: any) {
      setErr(e.message ?? 'deposit failed');
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    setErr(null); setMsg(null); setBusy('withdraw');
    try {
      await api.withdraw(toBase(amount, decimals).toString());
      const b = await api.balance();
      setWallet(b);
      setMsg('Withdrawal queued — tokens will arrive shortly.');
      api.transactions().then(setTxs).catch(() => {});
    } catch (e: any) {
      setErr(e.message ?? 'withdraw failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="👛 Wallet" onClose={onClose}>
      <div style={{ marginBottom: 12 }}>
        Balance: <b>{fromBase(balance, decimals)} 🪙</b>
      </div>
      <label style={lbl}>Amount</label>
      <input style={{ ...field, margin: '4px 0 12px' }} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={action} disabled={!!busy} onClick={deposit}>
          {busy === 'deposit' ? '…' : 'Deposit'}
        </button>
        <button style={{ ...action, background: '#3a3a5a', color: '#fff' }} disabled={!!busy} onClick={withdraw}>
          {busy === 'withdraw' ? '…' : 'Withdraw'}
        </button>
      </div>
      {msg && <p style={{ color: '#4be07a' }}>{msg}</p>}
      {err && <p style={{ color: '#f55' }}>{err}</p>}

      <div style={{ fontSize: 11, color: '#778', marginTop: 10, wordBreak: 'break-all' }}>
        Deposits go on-chain to the bankroll and are verified by the backend before crediting.
        Bankroll: {depositAddress}
      </div>

      {txs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={lbl}>Recent</div>
          {txs.slice(0, 8).map((t) => (
            <div key={t.id} style={{ fontSize: 12, color: '#99a', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.type}</span>
              <span>{fromBase(t.amount, decimals)}</span>
              <span style={{ color: t.status === 'CONFIRMED' ? '#4be07a' : t.status === 'FAILED' ? '#f55' : '#dd0' }}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, color: '#778', textTransform: 'uppercase' };
