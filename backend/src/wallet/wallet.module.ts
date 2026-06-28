import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { SolanaService } from './solana.service';
import { PayoutService } from './payout.service';
import { WalletController } from './wallet.controller';

/**
 * Global so game modules can inject LedgerService for stake debits and
 * winnings credits without re-importing.
 */
@Global()
@Module({
  providers: [LedgerService, SolanaService, PayoutService],
  controllers: [WalletController],
  exports: [LedgerService, SolanaService, PayoutService],
})
export class WalletModule {}
