import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider, keccak256, Wallet } from 'ethers';
import { NeonProxyRpcApi, SPLToken } from '@neonevm/token-transfer-core';
import { createWrapAndTransferSOLTransaction } from '@neonevm/token-transfer-ethers';
import { decode } from 'bs58';
import { sendSolanaTransaction, toSigner } from './utils';
require('dotenv').config();

const NEON_PRIVATE = process.env.NEON_PRIVATE;
const PHANTOM_PRIVATE = process.env.PHANTOM_PRIVATE;
const TOKEN_RECEIVER_CONTRACT = "0x1D1e8864997A2c684008539e780Df6934B6E4704"

// Updated configuration for SOL gas fee
const proxyUrl = 'https://devnet.neonevm.org/solana/sol';
const solanaUrl = 'https://api.devnet.solana.com';

async function sendSOL(amount: number, receiverAddress: string) {
    const connection = new Connection(solanaUrl, 'confirmed');
    const provider = new JsonRpcProvider(proxyUrl);
    const neonProxyRpcApi = new NeonProxyRpcApi(proxyUrl);
    
    if (!PHANTOM_PRIVATE) throw new Error('PHANTOM_PRIVATE not found in env');
    const solanaWallet = Keypair.fromSecretKey(decode(PHANTOM_PRIVATE));
    
    // Get SOL configuration
    const proxyStatus = await neonProxyRpcApi.evmParams();
    const gasTokens = await neonProxyRpcApi.nativeTokenList();
    const solToken = gasTokens.find(t => t.tokenName === 'SOL');
    
    if (!solToken) throw new Error('SOL token configuration not found');
    if (!proxyStatus.neonEvmProgramId) throw new Error('Neon EVM program ID not found');

    const neonEvmProgram = new PublicKey(proxyStatus.neonEvmProgramId);
    const chainId = parseInt(solToken.tokenChainId, 16);

    const walletSigner = new Wallet(
        keccak256(Buffer.from(`${receiverAddress.slice(2)}${solanaWallet.publicKey.toBase58()}`, 'utf-8')),
        provider
    );

    const solTokenConfig: SPLToken = {
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
        splToken: solTokenConfig,
        amount,
        chainId
    });

    const signature = await sendSolanaTransaction(connection, transaction, [toSigner(solanaWallet)], true);
    const data ={ signature, proxyUrl, chainId, receiverAddress, amount };
    return data;
}

// Example usage:
sendSOL(0.1, TOKEN_RECEIVER_CONTRACT)
  .then(console.table)
  .catch(console.error);

export { sendSOL };