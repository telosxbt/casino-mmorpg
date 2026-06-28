import { IsString, Length, Matches } from 'class-validator';

// On-chain Solana tx signature (base58, 64-88 chars).
export class DepositDto {
  @IsString()
  @Length(64, 100)
  signature!: string;
}

export class WithdrawDto {
  // Amount in token base units, as a decimal string (BigInt-safe, no overflow).
  @Matches(/^[1-9][0-9]{0,30}$/, { message: 'amount must be a positive integer (base units)' })
  amount!: string;
}
