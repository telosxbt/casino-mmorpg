import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';

/**
 * All on-chain interaction. Two jobs:
 *   - verifyDeposit: confirm a finalized SPL transfer of TOKEN_MINT from the
 *     player's wallet INTO the bankroll ATA, and return the exact amount moved.
 *     The frontend never tells us the amount — we read it from the chain.
 *   - sendPayout: transfer winnings/withdrawals out of the bankroll, signed
 *     with BANKROLL_PRIVATE_KEY (backend-only secret).
 */
@Injectable()
export class SolanaService implements OnModuleInit {
  private readonly log = new Logger(SolanaService.name);
  private connection!: Connection;
  private bankroll!: Keypair;
  private mint!: PublicKey;
  private bankrollWallet!: PublicKey;
  private bankrollAta!: PublicKey;
  decimals = 0;

  async onModuleInit() {
    this.connection = new Connection(process.env.SOLANA_RPC_URL as string, 'confirmed');
    this.bankroll = this.loadKeypair(process.env.BANKROLL_PRIVATE_KEY as string);
    this.mint = new PublicKey(process.env.TOKEN_MINT as string);
    this.bankrollWallet = new PublicKey(process.env.BANKROLL_WALLET as string);

    if (!this.bankroll.publicKey.equals(this.bankrollWallet)) {
      throw new Error('BANKROLL_PRIVATE_KEY does not match BANKROLL_WALLET');
    }
    this.bankrollAta = await getAssociatedTokenAddress(this.mint, this.bankrollWallet);
    try {
      const mintInfo = await getMint(this.connection, this.mint);
      this.decimals = mintInfo.decimals;
    } catch (e) {
      this.log.warn(`could not read mint decimals at boot: ${(e as Error).message}`);
    }
  }

  private loadKeypair(secret: string): Keypair {
    const s = secret.trim();
    // Accept either base58 or a JSON byte array.
    if (s.startsWith('[')) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
    }
    return Keypair.fromSecretKey(bs58.decode(s));
  }

  /**
   * Verify a deposit on-chain. Returns the amount (base units) of TOKEN_MINT
   * that `expectedFrom` transferred into the bankroll in this finalized tx,
   * or null if the tx is missing/unconfirmed/not a matching transfer.
   */
  async verifyDeposit(signature: string, expectedFrom: string): Promise<bigint | null> {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'finalized',
    });
    if (!tx || tx.meta?.err) return null;

    const mint = this.mint.toBase58();
    const bankrollAccts = new Set<number>();
    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];

    // Identify which account indexes belong to the bankroll for our mint.
    for (const b of post) {
      if (b.mint === mint && b.owner === this.bankrollWallet.toBase58()) {
        bankrollAccts.add(b.accountIndex);
      }
    }
    if (bankrollAccts.size === 0) return null;

    const amt = (list: typeof post, idx: number) =>
      BigInt(list.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? '0');

    // Net increase to the bankroll for this mint.
    let credited = 0n;
    for (const idx of bankrollAccts) {
      credited += amt(post, idx) - amt(pre, idx);
    }
    if (credited <= 0n) return null;

    // The payer's wallet must be a source: its balance for this mint dropped.
    const fromDropped = pre.some(
      (b) =>
        b.mint === mint &&
        b.owner === expectedFrom &&
        amt(post, b.accountIndex) < amt(pre, b.accountIndex),
    );
    if (!fromDropped) return null;

    return credited;
  }

  /**
   * Send `amount` base units of TOKEN_MINT from the bankroll to `toWallet`.
   * Creates the recipient ATA if needed. Returns the confirmed signature.
   * Caller must have already debited the ledger (idempotency upstream).
   */
  async sendPayout(toWallet: string, amount: bigint): Promise<string> {
    const recipient = new PublicKey(toWallet);
    const recipientAta = await getAssociatedTokenAddress(this.mint, recipient);

    const tx = new Transaction();
    try {
      await getAccount(this.connection, recipientAta);
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          this.bankroll.publicKey, // payer
          recipientAta,
          recipient,
          this.mint,
        ),
      );
    }
    tx.add(
      createTransferCheckedInstruction(
        this.bankrollAta,
        this.mint,
        recipientAta,
        this.bankroll.publicKey,
        amount,
        this.decimals,
      ),
    );

    const sig = await this.connection.sendTransaction(tx, [this.bankroll]);
    await this.connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }

  /** Current on-chain bankroll balance (base units) — for reconciliation/ops. */
  async bankrollBalance(): Promise<bigint> {
    try {
      const acc = await getAccount(this.connection, this.bankrollAta);
      return acc.amount;
    } catch {
      return 0n;
    }
  }
}
