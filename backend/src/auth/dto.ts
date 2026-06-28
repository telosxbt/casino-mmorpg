import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

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
  @IsOptional()
  @IsString()
  @Length(3, 20)
  username?: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 512)
  refreshToken!: string;
}

// Allowed cosmetic preset keys — must match frontend src/lib/looks.ts.
export const SKIN_KEYS = ['default', 'light', 'tan', 'brown', 'dark', 'pale'];
export const HAIR_KEYS = ['default', 'black', 'blonde', 'red', 'gray', 'white', 'blue', 'pink'];
export const SUIT_KEYS = ['default', 'blue', 'red', 'green', 'purple', 'white', 'gold', 'teal', 'burgundy', 'navy'];

export class ProfileDto {
  @IsString()
  @Length(3, 20)
  @Matches(/^[A-Za-z0-9_]+$/, { message: 'username: letters, numbers, underscore only' })
  username!: string;

  @IsIn(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
  gender!: 'MALE' | 'FEMALE';

  @IsOptional()
  @IsIn(SKIN_KEYS)
  skinTone?: string;

  @IsOptional()
  @IsIn(HAIR_KEYS)
  hairColor?: string;

  @IsOptional()
  @IsIn(SUIT_KEYS)
  suitColor?: string;
}
