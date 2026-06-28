import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { renderMvMap } from '../lib/mvMap';
import { WorldScene } from './WorldScene';
import { connect } from '../lib/socket';
import { api, setTokens } from '../lib/api';
import { useGame, useSession, type Interactable, type Zone } from '../store';

interface CasinoJson {
  spawn: { x: number; y: number };
  interactables: Interactable[];
  zones: Zone[];
  assets: {
    mapData: string;
    tilesets: string;
    tilesetImages: Record<number, string>;
    characters: string;
  };
}

/**
 * Boots the Phaser world and wires the realtime sockets to it. Movement,
 * presence, and chat bubbles all come from the server; this component just
 * translates socket events into scene calls and store updates.
 */
export function PhaserGame() {
  const ref = useRef<HTMLDivElement>(null);
  const tokens = useSession((s) => s.tokens);
  const setTokensOnly = useSession((s) => s.setTokensOnly);

  useEffect(() => {
    if (!tokens || !ref.current) return;
    let game: Phaser.Game | null = null;
    let cancelled = false;

    setTokens(tokens, (t) => setTokensOnly(t));

    (async () => {
      // Load shared map descriptor + bake the MV map.
      const casino: CasinoJson = await fetch('/assets/map/casino.json').then((r) => r.json());
      const mvMap = await renderMvMap(casino.assets.mapData, casino.assets.tilesets, casino.assets.tilesetImages);
      if (cancelled) return;

      // Pull balance into the HUD.
      api.balance().then((b) => useGame.getState().setWallet(b)).catch(() => {});

      const world = connect('world', tokens.accessToken);
      const chat = connect('chat', tokens.accessToken);
      const lobby = connect('lobby', tokens.accessToken);

      const scene = new WorldScene();
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: ref.current!,
        width: window.innerWidth,
        height: window.innerHeight,
        pixelArt: true,
        scale: { mode: Phaser.Scale.RESIZE },
        scene,
        backgroundColor: '#0b0b12',
      });

      scene.scene.start('World', {
        mvMap,
        charUrl: casino.assets.characters,
        spawn: casino.spawn,
        interactables: casino.interactables,
        zones: casino.zones ?? [],
        selfId: tokens.user,
        onMoveTo: (tile: { x: number; y: number }) => world.emit('move', tile),
        onNear: (i: Interactable | null) => useGame.getState().setNearby(i),
        onZone: (z: Zone | null) => useGame.getState().setNearbyZone(z),
      });

      // Live lobby list (create/update/remove fan out to every client).
      lobby.on('lobby:update', (l: any) => useGame.getState().upsertLobby(l));
      lobby.on('lobby:removed', (d: any) => useGame.getState().removeLobby(d.id));

      // ── World presence + movement ──
      world.on('world:init', (d: any) => {
        scene.upsertPlayer({ ...d.self });
        for (const pl of d.players) scene.upsertPlayer(pl);
      });
      world.on('player:join', (pl: any) => scene.upsertPlayer(pl));
      world.on('player:leave', (d: any) => scene.removePlayer(d.userId));
      world.on('player:move', (d: any) => scene.movePlayer(d));
      world.on('player:idle', (d: any) => scene.movePlayer({ ...d, moving: false }));

      // ── Chat ──
      chat.emit('chat:history', null, (history: any[]) => {
        if (Array.isArray(history)) useGame.getState().setChat(history);
      });
      chat.on('chat:message', (m: any) => useGame.getState().pushChat(m));
      chat.on('chat:bubble', (b: any) => scene.showBubble(b.userId, b.body));
    })();

    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [tokens, setTokensOnly]);

  return <div ref={ref} style={{ position: 'fixed', inset: 0 }} />;
}
