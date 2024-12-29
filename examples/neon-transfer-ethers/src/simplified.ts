import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Interface, JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import { NeonProxyRpcApi, SPLToken } from '@neonevm/token-transfer-core';
import { createWrapAndTransferSOLTransaction } from '@neonevm/token-transfer-ethers';
import { decode } from 'bs58';
import { sendSolanaTransaction, toSigner } from './utils';
require('dotenv').config();

const NEON_PRIVATE = process.env.NEON_PRIVATE;
const PHANTOM_PRIVATE = process.env.PHANTOM_PRIVATE;
const TOKEN_RECEIVER_CONTRACT = "0x1D1e8864997A2c684008539e780Df6934B6E4704";

const proxyUrl = 'https://devnet.neonevm.org/solana/sol';
const solanaUrl = 'https://api.devnet.solana.com';

const TOKEN_RECEIVER_ABI = [
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "nullifier",
                "type": "uint256"
            }
        ],
        "name": "receiveWithNullifier",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

interface BridgeResult {
    signature: string;
    neonWalletAddress: string;
    amount: number;
}

async function bridgeSOLToNeon(amount: number): Promise<BridgeResult> {
    if (!NEON_PRIVATE) throw new Error('NEON_PRIVATE not found in env');
    if (!PHANTOM_PRIVATE) throw new Error('PHANTOM_PRIVATE not found in env');

    const connection = new Connection(solanaUrl, 'confirmed');
    const provider = new JsonRpcProvider(proxyUrl);
    const neonProxyRpcApi = new NeonProxyRpcApi(proxyUrl);
    const solanaWallet = Keypair.fromSecretKey(decode(PHANTOM_PRIVATE));
    const neonWallet = new Wallet(NEON_PRIVATE);
    
    const proxyStatus = await neonProxyRpcApi.evmParams();
    const gasTokens = await neonProxyRpcApi.nativeTokenList();
    const solToken = gasTokens.find(t => t.tokenName === 'SOL');
    
    if (!solToken) throw new Error('SOL token configuration not found');
    if (!proxyStatus.neonEvmProgramId) throw new Error('Neon EVM program ID not found');

    const neonEvmProgram = new PublicKey(proxyStatus.neonEvmProgramId);
    const chainId = parseInt(solToken.tokenChainId, 16);

    const solTokenConfig: SPLToken = {
        chainId,
        address_spl: 'So11111111111111111111111111111111111111112',
        address: '0x8053E6e199C9f89B3E5E4114Cb8bF45eE1928420',
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
        neonWallet: TOKEN_RECEIVER_CONTRACT,
        walletSigner: new Wallet(NEON_PRIVATE, provider),
        splToken: solTokenConfig,
        amount,
        chainId
    });

    const signature = await sendSolanaTransaction(connection, transaction, [toSigner(solanaWallet)], true);
    
    return {
        signature,
        neonWalletAddress: neonWallet.address,
        amount
    };
}


async function runTests() {
    console.log('Running tests...');
    
    try {
        // Test 1: Bridge SOL
        console.log('Test 1: Bridging SOL to Neon wallet');
        const testAmount = 0.01;
        const bridgeResult = await bridgeSOLToNeon(testAmount);
        console.assert(bridgeResult.signature, 'Should return a valid signature');
        console.assert(bridgeResult.amount === testAmount, 'Amount should match');
        console.log('Bridge transaction signature:', bridgeResult.signature);
        console.log('Test 1 passed ✓');

    } catch (error) {
        console.error('Test failed:', error);
        throw error;
    }
}

if (require.main === module) {
    runTests().catch(console.error);
}

export { bridgeSOLToNeon, TOKEN_RECEIVER_CONTRACT };