import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Gender } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrismaService } from '../prisma/prisma.service';

const NONCE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;

export interface JwtPayload {
  sub: string; // user id
  wallet: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Step 1: issue a one-time nonce the user must sign with their wallet. */
  async issueNonce(walletAddress: string): Promise<{ message: string }> {
    const nonce = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

    // Upsert a user+wallet shell keyed by address; identity is the pubkey.
    const user = await this.prisma.user.upsert({
      where: { walletAddress },
      update: {},
      create: {
        walletAddress,
        username: `player_${walletAddress.slice(0, 6)}`,
        wallet: { create: { address: walletAddress } },
      },
      include: { wallet: true },
    });

    await this.prisma.wallet.update({
      where: { userId: user.id },
      data: { authNonce: nonce, authNonceExp: expiresAt },
    });

    return { message: this.nonceMessage(walletAddress, nonce) };
  }

  private nonceMessage(wallet: string, nonce: string): string {
    return `Sign in to Casino MMORPG\nWallet: ${wallet}\nNonce: ${nonce}`;
  }

  /** Step 2: verify the ed25519 signature over the exact nonce message. */
  async verify(walletAddress: string, signatureB58: string, username?: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { address: walletAddress },
      include: { user: true },
    });
    if (!wallet?.authNonce || !wallet.authNonceExp) {
      throw new BadRequestException('request a nonce first');
    }
    if (wallet.authNonceExp.getTime() < Date.now()) {
      throw new UnauthorizedException('nonce expired');
    }

    const message = this.nonceMessage(walletAddress, wallet.authNonce);
    const ok = this.verifySignature(message, signatureB58, walletAddress);
    if (!ok) throw new UnauthorizedException('signature verification failed');

    // Consume the nonce immediately (single use → replay-proof).
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { authNonce: null, authNonceExp: null },
    });

    if (username) await this.maybeSetUsername(wallet.userId, username);

    return this.issueTokens({ sub: wallet.userId, wallet: walletAddress });
  }

  private verifySignature(message: string, sigB58: string, walletB58: string): boolean {
    try {
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = bs58.decode(sigB58);
      const pubKey = bs58.decode(walletB58);
      return nacl.sign.detached.verify(msgBytes, sigBytes, pubKey);
    } catch {
      return false;
    }
  }

  private async maybeSetUsername(userId: string, username: string) {
    const taken = await this.prisma.user.findFirst({
      where: { username, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('username taken');
    await this.prisma.user.update({ where: { id: userId }, data: { username } });
  }

  /** Issue access JWT + rotating refresh token (hash stored, raw returned). */
  async issueTokens(payload: JwtPayload) {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ACCESS_TTL,
    });

    const refreshRaw = randomBytes(48).toString('base64url');
    const refreshTokenHash = this.hash(refreshRaw);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);

    await this.prisma.session.create({
      data: { userId: payload.sub, refreshTokenHash, expiresAt },
    });

    return { accessToken, refreshToken: refreshRaw, user: payload.sub };
  }

  /** Rotate: validate refresh, revoke old session, issue a fresh pair. */
  async refresh(refreshRaw: string) {
    const hash = this.hash(refreshRaw);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('invalid refresh token');
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens({ sub: session.userId, wallet: session.user.walletAddress });
  }

  private readonly profileSelect = {
    username: true,
    avatar: true,
    gender: true,
    profileComplete: true,
    skinTone: true,
    hairColor: true,
    suitColor: true,
  } as const;

  /** Current player profile — used to decide whether to show first-login setup. */
  async getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: this.profileSelect });
  }

  /**
   * First-login profile setup: username + sex (sets avatar sprite) + optional
   * cosmetic recolor presets (skin/hair/suit). Username must be unique.
   */
  async setProfile(
    userId: string,
    username: string,
    gender: Gender,
    look: { skinTone?: string; hairColor?: string; suitColor?: string } = {},
  ) {
    const taken = await this.prisma.user.findFirst({
      where: { username, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('username taken');
    const avatar = gender === 'FEMALE' ? 'female' : 'male';
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        username,
        gender,
        avatar,
        profileComplete: true,
        skinTone: look.skinTone ?? 'default',
        hairColor: look.hairColor ?? 'default',
        suitColor: look.suitColor ?? 'default',
      },
      select: this.profileSelect,
    });
  }

  /** Server-side invalidation: kill all of a user's sessions. */
  async logoutAll(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hash(v: string): string {
    return createHash('sha256').update(v).digest('hex');
  }
}
