import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider, keccak256, Wallet } from 'ethers';
import { NeonProxyRpcApi, SPLToken } from '@neonevm/token-transfer-core';
import { createWrapAndTransferSOLTransaction } from '@neonevm/token-transfer-ethers';
import { decode } from 'bs58';
import {sendSolanaTransaction, toSigner} from './utils';
require('dotenv').config();

const NEON_PRIVATE = process.env.NEON_PRIVATE;
const PHANTOM_PRIVATE = process.env.PHANTOM_PRIVATE;

const proxyUrl = 'https://devnet.neonevm.org';
const solanaUrl = 'https://api.devnet.solana.com';
const neonEvmProgram = new PublicKey('eeLSJgWzzxrqKv1UxtRVVH8FX3qCQWUs9QuAjJpETGU');
const chainId = parseInt('0xe9ac0ce');

async function sendSOL(amount: number, receiverAddress: string) {
    const connection = new Connection(solanaUrl, 'confirmed');
    const provider = new JsonRpcProvider(proxyUrl);
    const neonProxyRpcApi = new NeonProxyRpcApi(proxyUrl);
    
    if (!PHANTOM_PRIVATE) throw new Error('PHANTOM_PRIVATE not found in env');
    const solanaWallet = Keypair.fromSecretKey(decode(PHANTOM_PRIVATE));
    
    const walletSigner = new Wallet(
        keccak256(Buffer.from(`${receiverAddress.slice(2)}${solanaWallet.publicKey.toBase58()}`, 'utf-8')),
        provider
    );

    const solToken: SPLToken = {
        chainId,
        address_spl: 'So11111111111111111111111111111111111111112',
        address: '0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c',
        decimals: 9,
        name: 'SOL',
        symbol: 'SOL',
        logoURI: 'https://raw.githubusercontent.com/neonlabsorg/token-list/master/assets/solana-wsol-logo.svg'
      };

    const transaction = await createWrapAndTransferSOLTransaction({
        connection,
        proxyApi: neonProxyRpcApi,
        neonEvmProgram,
        solanaWallet: solanaWallet.publicKey,
        neonWallet: receiverAddress,
        walletSigner,
        splToken: solToken,
        amount,
        chainId
    });

    const signature = await sendSolanaTransaction(connection, transaction, [toSigner(solanaWallet)], true);
    
    return signature;
}

// Example usage:
sendSOL(0.1, '0xf111741a15435abd3bedbccb4baaf741e388fb28')
  .then(console.log)
  .catch(console.error);

export { sendSOL };