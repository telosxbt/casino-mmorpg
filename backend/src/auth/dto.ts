import { IsString, Length, Matches } from 'class-validator';

// base58 Solana address, 32-44 chars.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class NonceDto {
  @Matches(BASE58, { message: 'invalid wallet address' })
  walletAddress!: string;
}

export class VerifyDto {
  @Matches(BASE58, { message: 'invalid wallet address' })
  walletAddress!: string;

  // base58-encoded ed25519 signature of the nonce message.
  @IsString()
  @Length(64, 128)
  signature!: string;

  // Optional desired username on first login.
  @IsString()
  @Length(3, 20)
  username?: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 512)
  refreshToken!: string;
}
