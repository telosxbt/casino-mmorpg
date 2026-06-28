import { useState } from 'react';
import { useGame, useSession } from '../store';
import { fromBase } from '../lib/format';
import { get } from '../lib/socket';
import { SlotsModal } from './SlotsModal';
import { RouletteModal } from './RouletteModal';
import { BlackjackModal } from './BlackjackModal';
import { WalletModal } from './WalletModal';
import { LobbyBrowser } from './LobbyBrowser';

/** Top bar (balance + wallet), chat, the "play" prompt, and the modal router. */
export function Hud() {
  const { balance, decimals, nearby, nearbyZone, modal, openModal, closeModal, toast } = useGame();
  const clear = useSession((s) => s.clear);

  return (
    <>
      <div style={bar}>
        <span style={{ fontWeight: 700 }}>🎰 Casino</span>
        <span style={{ flex: 1 }} />
        <span style={chip}>{fromBase(balance, decimals)} 🪙</span>
        <button style={btn} onClick={() => openModal({ kind: 'WALLET' })}>
          Wallet
        </button>
        <button style={btnGhost} onClick={clear}>
          Exit
        </button>
      </div>

      {!modal && nearby && (
        <button style={prompt} onClick={() => openModal({ kind: 'SLOTS', machine: nearby })}>
          ▶ Play {nearby.label}
        </button>
      )}
      {!modal && !nearby && nearbyZone && (
        <button style={prompt} onClick={() => openModal({ kind: 'LOBBY', zone: nearbyZone })}>
          ▶ {nearbyZone.label} — browse tables
        </button>
      )}

      <Chat />

      {toast && <div style={toastStyle}>{toast}</div>}

      {modal?.kind === 'SLOTS' && <SlotsModal machine={modal.machine} onClose={closeModal} />}
      {modal?.kind === 'LOBBY' && (
        <LobbyBrowser
          zone={modal.zone}
          onClose={closeModal}
          onEnter={(lobbyId, name) => openModal({ kind: modal.zone.type, lobbyId, name })}
        />
      )}
      {modal?.kind === 'ROULETTE' && <RouletteModal lobbyId={modal.lobbyId} name={modal.name} onClose={closeModal} />}
      {modal?.kind === 'BLACKJACK' && <BlackjackModal lobbyId={modal.lobbyId} name={modal.name} onClose={closeModal} />}
      {modal?.kind === 'WALLET' && <WalletModal onClose={closeModal} />}
    </>
  );
}

function Chat() {
  const chat = useGame((s) => s.chat);
  const selfId = useSession((s) => s.tokens?.user);
  const [text, setText] = useState('');

  function send() {
    const body = text.trim();
    if (!body) return;
    get('chat')?.emit('chat:send', { scope: 'GLOBAL', body });
    setText('');
  }

  return (
    <div style={chatBox}>
      <div style={chatLog}>
        {chat.map((m) => (
          <div key={m.id} style={{ marginBottom: 2 }}>
            <b style={{ color: m.userId === selfId ? '#7ad' : '#da7' }}>{m.username}:</b> {m.body}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          style={chatInput}
          value={text}
          maxLength={200}
          placeholder="Say something…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button style={btn} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

const bar: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'center',
  gap: 8, padding: '0 12px', background: '#15151fee', borderBottom: '1px solid #2a2a3a', zIndex: 10,
};
const chip: React.CSSProperties = { background: '#222234', padding: '4px 10px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' };
const btn: React.CSSProperties = { background: '#3a3a5a', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', border: '1px solid #3a3a5a' };
const prompt: React.CSSProperties = {
  position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
  background: '#e0c84b', color: '#111', border: 0, padding: '12px 24px', borderRadius: 12, fontWeight: 700, cursor: 'pointer',
};
const chatBox: React.CSSProperties = {
  position: 'fixed', bottom: 12, left: 12, width: 320, zIndex: 10,
  background: '#10101acc', borderRadius: 10, padding: 8, border: '1px solid #2a2a3a',
};
const chatLog: React.CSSProperties = { height: 140, overflowY: 'auto', fontSize: 13, marginBottom: 6 };
const chatInput: React.CSSProperties = { flex: 1, background: '#1c1c2a', color: '#fff', border: '1px solid #2a2a3a', borderRadius: 8, padding: '6px 8px' };
const toastStyle: React.CSSProperties = {
  position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
  background: '#222234', color: '#fff', padding: '8px 16px', borderRadius: 8, border: '1px solid #3a3a5a',
};

export { btn, btnGhost, chip };
