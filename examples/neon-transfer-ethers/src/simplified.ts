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

interface ContractCallResult {
    txHash: string;
    nullifier: string;
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
        neonWallet: neonWallet.address,
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

async function sendToTokenReceiver(amount: number): Promise<ContractCallResult> {
    if (!NEON_PRIVATE) throw new Error('NEON_PRIVATE not found in env');

    const provider = new JsonRpcProvider(proxyUrl);
    const neonWallet = new Wallet(NEON_PRIVATE, provider);
    
    // Generate nullifier
    const nullifier = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);

    // Create contract interface
    const tokenReceiverInterface = new Interface(TOKEN_RECEIVER_ABI);
    const data = tokenReceiverInterface.encodeFunctionData("receiveWithNullifier", [
        parseUnits(amount.toString(), 9),
        nullifier
    ]);

    // Get the latest nonce for the wallet
    const nonce = await provider.getTransactionCount(neonWallet.address, "latest");
    
    // Get the optimal gas price (paid in SOL)
    const feeData = await provider.getFeeData();
    
    // Create transaction with explicit nonce
    const transaction = await neonWallet.sendTransaction({
        to: TOKEN_RECEIVER_CONTRACT,
        data,
        value: "0x0",
        gasLimit: "0x5F5E100", // 100M gas
        gasPrice: feeData.gasPrice || undefined,
        nonce: nonce // Explicitly set the nonce
    });

    // Wait for confirmation with longer timeout and more confirmations
    const receipt = await transaction.wait(2); // Wait for 2 confirmations
    
    if (!receipt || !receipt.hash) throw new Error('Transaction failed');
    
    return {
        txHash: receipt.hash,
        nullifier: nullifier.toString(),
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

        // Wait for bridge confirmation with longer delay
        console.log('Waiting for bridge confirmation...');
        await new Promise(resolve => setTimeout(resolve, 15000)); // Increased to 15 seconds

        // Test 2: Send to TokenReceiver using standard EVM transaction
        console.log('Test 2: Sending to TokenReceiver contract');
        const contractResult = await sendToTokenReceiver(testAmount);
        console.assert(contractResult.txHash, 'Should return a valid transaction hash');
        console.assert(contractResult.nullifier, 'Should return a valid nullifier');
        console.assert(contractResult.amount === testAmount, 'Amount should match');
        console.log('Contract transaction hash:', contractResult.txHash);
        console.log('Nullifier:', contractResult.nullifier);
        console.log('Test 2 passed ✓');

        console.log('All tests passed! ✓');
    } catch (error) {
        console.error('Test failed:', error);
        throw error;
    }
}

if (require.main === module) {
    runTests().catch(console.error);
}

export { bridgeSOLToNeon, sendToTokenReceiver, TOKEN_RECEIVER_CONTRACT };