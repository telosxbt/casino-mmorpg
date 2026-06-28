import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { connect } from '../lib/socket';
import { useGame, useSession, type Zone } from '../store';

/**
 * Lobby browser for a gaming zone. Lists all live lobbies (kept in sync by the
 * lobby socket), lets the player create a new one or join an existing one —
 * including games already in progress. On join, opens the matching game window.
 */
export function LobbyBrowser({
  zone,
  onEnter,
  onClose,
}: {
  zone: Zone;
  onEnter: (lobbyId: string, name: string) => void;
  onClose: () => void;
}) {
  const token = useSession((s) => s.tokens?.accessToken)!;
  const lobbies = useGame((s) => Object.values(s.lobbies).filter((l) => l.type === zone.type));
  const setLobbies = useGame((s) => s.setLobbies);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = connect('lobby', token);
    s.emit('lobby:list', { type: zone.type }, (list: any[]) => {
      if (Array.isArray(list)) setLobbies(list);
    });
    const onJoined = (l: any) => { setBusy(false); onEnter(l.id, l.name); };
    const onErr = (d: any) => { setBusy(false); setErr(d.reason); };
    s.on('lobby:joined', onJoined);
    s.on('lobby:error', onErr);
    return () => { s.off('lobby:joined', onJoined); s.off('lobby:error', onErr); };
  }, [zone.type, token, onEnter, setLobbies]);

  function create() {
    setErr(null); setBusy(true);
    connect('lobby', token).emit('lobby:create', { type: zone.type, name: name.trim() || undefined });
  }
  function join(id: string) {
    setErr(null); setBusy(true);
    connect('lobby', token).emit('lobby:join', { id });
  }

  const icon = zone.type === 'ROULETTE' ? '🎡' : '🃏';

  return (
    <Modal title={`${icon} ${zone.label}`} onClose={onClose} width={460}>
      <div style={{ fontSize: 12, letterSpacing: 2, color: '#e9cf8e', marginBottom: 8 }}>OPEN TABLES</div>
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lobbies.length === 0 && (
          <div style={{ textAlign: 'center', padding: 16, color: '#b9a574' }}>
            No tables yet — create the first one!
          </div>
        )}
        {lobbies.map((l) => {
          const full = l.players >= l.max;
          return (
            <div key={l.id} className="cz-felt" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: '#fffef7' }}>{l.name}</div>
                <div style={{ fontSize: 12, color: '#bfe6cd' }}>{l.players}/{l.max} seated{full ? ' · full' : ''}</div>
              </div>
              <button className="cz-btn" style={{ padding: '8px 16px' }} disabled={busy || full} onClick={() => join(l.id)}>
                {full ? 'Full' : 'Join'}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: '1px solid #ffffff22', marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: '#e9cf8e', marginBottom: 8 }}>NEW TABLE</div>
        <div className="cz-row">
          <input className="cz-input" placeholder="Table name…" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="cz-btn" disabled={busy} onClick={create}>Create</button>
        </div>
      </div>
      {err && <div className="cz-err">{err}</div>}
    </Modal>
  );
}
