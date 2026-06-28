import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { JwtPayload } from './auth.service';

/**
 * Socket authentication. Every socket must present a valid access JWT in the
 * handshake (auth.token or Authorization header) before it can join rooms or
 * emit privileged events. Used by the world/game gateways in later phases.
 *
 * Usage in a gateway:
 *   afterInit(server) { server.use(socketAuthMiddleware(this.jwt)); }
 * then read socket.data.user on each event.
 */
export function socketAuthMiddleware(jwt: JwtService) {
  return async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const raw =
        (socket.handshake.auth?.token as string | undefined) ??
        socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!raw) return next(new Error('unauthorized: no token'));

      const payload = await jwt.verifyAsync<JwtPayload>(raw, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      socket.data.user = { sub: payload.sub, wallet: payload.wallet };
      next();
    } catch {
      next(new Error('unauthorized: bad token'));
    }
  };
}
