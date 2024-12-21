import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { 
  getAccount, 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction, 
  createSyncNativeInstruction, 
  NATIVE_MINT 
} from '@solana/spl-token';
import {
  createAssociatedTokenAccountTransaction,
  NeonProxyRpcApi,
  SPLToken
} from '@neonevm/token-transfer-core';
import {
  createMintNeonTransactionEthers,
  neonTransferMintTransactionEthers
} from '@neonevm/token-transfer-ethers';
import { JsonRpcProvider, keccak256, Wallet } from 'ethers';
import { decode } from 'bs58';
import { sendNeonTransactionEthers, sendSolanaTransaction, toSigner } from './utils';

require('dotenv').config({ path: `./.env` });

const NEON_PRIVATE = process.env.NEON_PRIVATE;
const PHANTOM_PRIVATE = process.env.PHANTOM_PRIVATE;

const proxyUrl = `https://devnet.neonevm.org`;
const solanaUrl = `https://api.devnet.solana.com`;

const connection = new Connection(solanaUrl, 'confirmed');
const provider: any = new JsonRpcProvider(proxyUrl);

const neonWallet: any = new Wallet(NEON_PRIVATE!, provider);
const solanaWallet = Keypair.fromSecretKey(decode(PHANTOM_PRIVATE!));

const neonEvmProgram = new PublicKey(`eeLSJgWzzxrqKv1UxtRVVH8FX3qCQWUs9QuAjJpETGU`);
const chainId = parseInt(`0xe9ac0ce`);

const neonProxyRpcApi = new NeonProxyRpcApi(proxyUrl);

export async function convertSOLToWSOL(amount: number): Promise<string> {
  const walletBalance = await connection.getBalance(solanaWallet.publicKey);
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(0);
  
  if (walletBalance < amount * 1e9 + rentExemptBalance) {
    throw new Error('Insufficient SOL balance');
  }

  const associatedTokenAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    solanaWallet.publicKey
  );

  const transaction = new Transaction();
  
  // Create token account if it doesn't exist
  try {
    await getAccount(connection, associatedTokenAccount);
  } catch (e) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        solanaWallet.publicKey,
        associatedTokenAccount,
        solanaWallet.publicKey,
        NATIVE_MINT
      )
    );
  }

  // Transfer SOL to token account
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: solanaWallet.publicKey,
      toPubkey: associatedTokenAccount,
      lamports: amount * 1e9
    }),
    createSyncNativeInstruction(associatedTokenAccount)
  );

  const signature = await sendSolanaTransaction(connection, transaction, [toSigner(solanaWallet)], true);
  return signature;
}

export async function transferSPLTokenToNeonEvm(token: SPLToken, amount: number): Promise<any> {
  const walletSigner = new Wallet(keccak256(Buffer.from(`${neonWallet.address.slice(2)}${solanaWallet.publicKey.toBase58()}`, 'utf-8')), provider);
  const transaction = await neonTransferMintTransactionEthers({
    connection,
    proxyApi: neonProxyRpcApi,
    neonEvmProgram,
    solanaWallet: solanaWallet.publicKey,
    neonWallet: neonWallet.address,
    walletSigner,
    splToken: token,
    amount,
    chainId
  });
  const signature = await sendSolanaTransaction(connection, transaction, [toSigner(solanaWallet)]);
  console.log(signature);
}

export async function transferERC20TokenToSolana(token: SPLToken, amount: number): Promise<any> {
  const mint = new PublicKey(token.address_spl);
  const associatedToken = getAssociatedTokenAddressSync(mint, solanaWallet.publicKey);
  try {
    await getAccount(connection, associatedToken);
  } catch (e) {
    const solanaTransaction = createAssociatedTokenAccountTransaction({
      solanaWallet: solanaWallet.publicKey,
      tokenMint: mint,
      associatedToken
    });
    const signature = sendSolanaTransaction(connection, solanaTransaction, [toSigner(solanaWallet)]);
    console.log(signature);
  }
  const transaction = await createMintNeonTransactionEthers({
    provider,
    neonWallet: neonWallet.address,
    associatedToken,
    splToken: token,
    amount
  });
  const hash = await sendNeonTransactionEthers(transaction, neonWallet);
  console.log(hash);
}