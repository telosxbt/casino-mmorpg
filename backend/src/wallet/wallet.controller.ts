import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LedgerService } from './ledger.service';
import { PayoutService } from './payout.service';
import { SolanaService } from './solana.service';
import { DepositDto, WithdrawDto } from './dto';

/**
 * Wallet/ledger HTTP surface. Identity always comes from the JWT (req.user),
 * never from the request body — the frontend can't claim to be another wallet.
 */
@UseGuards(AuthGuard('jwt'))
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly payout: PayoutService,
    private readonly solana: SolanaService,
  ) {}

  @Get('balance')
  async balance(@Req() req: any) {
    const balance = await this.ledger.getBalance(req.user.sub);
    return {
      balance: balance.toString(),
      depositAddress: process.env.BANKROLL_WALLET,
      mint: process.env.TOKEN_MINT,
      decimals: this.solana.decimals,
    };
  }

  /** Submit an on-chain deposit signature; we verify it and credit the ledger. */
  @Post('deposit')
  async deposit(@Req() req: any, @Body() dto: DepositDto) {
    const ok = await this.redis.allow(`deposit:${req.user.sub}`, 20, 60);
    if (!ok) throw new BadRequestException('rate limit exceeded');

    const amount = await this.solana.verifyDeposit(dto.signature, req.user.wallet);
    if (!amount || amount <= 0n) {
      throw new BadRequestException('no matching finalized deposit found for this signature');
    }
    const balance = await this.ledger.creditDeposit(req.user.sub, amount, dto.signature);
    return { credited: amount.toString(), balance: balance.toString() };
  }

  /** Withdraw in-game balance back to the player's own wallet (from JWT). */
  @Post('withdraw')
  async withdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    const ok = await this.redis.allow(`withdraw:${req.user.sub}`, 5, 60);
    if (!ok) throw new BadRequestException('rate limit exceeded');

    const res = await this.payout.requestWithdraw(req.user.sub, req.user.wallet, BigInt(dto.amount));
    return res;
  }

  @Get('transactions')
  async transactions(@Req() req: any) {
    const rows = await this.prisma.transaction.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      amount: r.amount.toString(),
      onchainSig: r.onchainSig,
      createdAt: r.createdAt,
    }));
  }
}
