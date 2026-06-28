// Deposit flow: build an SPL token transfer from the player's wallet to the
// bankroll and have Phantom sign+send it. We only return the signature — the
// backend verifies the amount on-chain (the client is never trusted for value).
import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

const RPC = import.meta.env.VITE_SOLANA_RPC_URL as string;
const MINT = new PublicKey(import.meta.env.VITE_TOKEN_MINT as string);
const BANKROLL = new PublicKey(import.meta.env.VITE_BANKROLL_WALLET as string);

/**
 * Transfer `amount` base units of the casino token to the bankroll using
 * Phantom. Returns the confirmed tx signature for the backend to verify.
 */
export async function depositToBankroll(amount: bigint, decimals: number): Promise<string> {
  const provider = (window as any).solana;
  if (!provider?.isPhantom) throw new Error('Phantom not found');
  const owner = new PublicKey(provider.publicKey.toString());
  const connection = new Connection(RPC, 'confirmed');

  const fromAta = await getAssociatedTokenAddress(MINT, owner);
  const toAta = await getAssociatedTokenAddress(MINT, BANKROLL);

  const tx = new Transaction();
  // Create the bankroll ATA if it somehow doesn't exist yet (payer = player).
  try {
    await getAccount(connection, toAta);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(owner, toAta, BANKROLL, MINT));
  }
  tx.add(createTransferCheckedInstruction(fromAta, MINT, toAta, owner, amount, decimals));

  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const signed = await provider.signAndSendTransaction(tx);
  const signature = signed.signature ?? signed;
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}
