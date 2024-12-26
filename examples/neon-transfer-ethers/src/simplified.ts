import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Interface, JsonRpcProvider, Wallet, keccak256, parseUnits } from 'ethers';
import { 
    NeonProxyRpcApi, 
    SPLToken, 
    EvmInstruction,
    collateralPoolAddress,
    holderAccountData,
    neonBalanceProgramAddressV2
} from '@neonevm/token-transfer-core';
import { createWrapAndTransferSOLTransaction } from '@neonevm/token-transfer-ethers';
import { decode } from 'bs58';
import { sendSolanaTransaction, toSigner } from './utils';
require('dotenv').config();

// Configuration Constants
const NEON_PRIVATE = process.env.NEON_PRIVATE;
const PHANTOM_PRIVATE = process.env.PHANTOM_PRIVATE;
const TOKEN_RECEIVER_CONTRACT = "0x1D1e8864997A2c684008539e780Df6934B6E4704";
const proxyUrl = 'https://devnet.neonevm.org/solana/sol';
const solanaUrl = 'https://api.devnet.solana.com';
const TREASURY_POOL_COUNT = 128;
const HOLDER_ACCOUNT_SPACE = 128 * 1024; // 128KB

// Contract ABI
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

// Type Definitions
interface BridgeResult {
    signature: string;
    neonWalletAddress: string;
    amount: number;
}

interface ContractCallResult {
    signature: string;
    nullifier: string;
    amount: number;
}

interface CreateInstructionParams {
    solanaWallet: PublicKey;
    neonWallet: string;
    holderAccount: PublicKey;
    neonEvmProgram: PublicKey;
    neonRawTransaction: string;
    chainId: number;
}

// Helper Functions for Creating Instructions
async function createExecFromDataInstruction({
    solanaWallet,
    neonWallet,
    holderAccount,
    neonEvmProgram,
    neonRawTransaction,
    chainId
}: CreateInstructionParams): Promise<TransactionInstruction> {
    const treasuryPoolIndex = Math.floor(Math.random() * TREASURY_POOL_COUNT);
    const [balanceAccount] = neonBalanceProgramAddressV2(neonWallet, solanaWallet, neonEvmProgram, chainId);
    const [treasuryPoolAddress] = collateralPoolAddress(neonEvmProgram, treasuryPoolIndex);

    const instructionType = Buffer.from([EvmInstruction.TransactionExecuteFromInstruction]);
    const poolIndex = Buffer.alloc(4);
    poolIndex.writeUInt32LE(treasuryPoolIndex, 0);
    const transactionData = Buffer.from(neonRawTransaction.slice(2), 'hex');
    const data = Buffer.concat([instructionType, poolIndex, transactionData]);

    const keys = [
        { pubkey: holderAccount, isSigner: false, isWritable: true },
        { pubkey: solanaWallet, isSigner: true, isWritable: true },
        { pubkey: treasuryPoolAddress, isSigner: false, isWritable: true },
        { pubkey: balanceAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: true }
    ];

    return new TransactionInstruction({ programId: neonEvmProgram, keys, data });
}

function createAccountWithSeedInstruction(
    solanaWallet: PublicKey,
    seed: string,
    holderAccount: PublicKey,
    neonEvmProgram: PublicKey
): TransactionInstruction {
    return SystemProgram.createAccountWithSeed({
        fromPubkey: solanaWallet,
        newAccountPubkey: holderAccount,
        basePubkey: solanaWallet,
        seed,
        lamports: 0,
        space: HOLDER_ACCOUNT_SPACE,
        programId: neonEvmProgram
    });
}

function createHolderAccountInstruction(
    holderAccount: PublicKey,
    solanaWallet: PublicKey,
    neonEvmProgram: PublicKey,
    seed: string
): TransactionInstruction {
    const instruction = Buffer.from([EvmInstruction.HolderCreate]);
    const seedLength = Buffer.alloc(8);
    seedLength.writeUInt32LE(seed.length, 0);
    const seedBuffer = Buffer.from(seed, 'utf-8');
    const data = Buffer.concat([instruction, seedLength, seedBuffer]);

    const keys = [
        { pubkey: holderAccount, isSigner: false, isWritable: true },
        { pubkey: solanaWallet, isSigner: true, isWritable: false }
    ];

    return new TransactionInstruction({ programId: neonEvmProgram, keys, data });
}

function createDeleteHolderInstruction(
    holderAccount: PublicKey,
    solanaWallet: PublicKey,
    neonEvmProgram: PublicKey
): TransactionInstruction {
    const data = Buffer.from([EvmInstruction.HolderDelete]);
    const keys = [
        { pubkey: holderAccount, isSigner: false, isWritable: true },
        { pubkey: solanaWallet, isSigner: true, isWritable: false }
    ];
    return new TransactionInstruction({ programId: neonEvmProgram, keys, data });
}

// Main Functions
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
    if (!PHANTOM_PRIVATE) throw new Error('PHANTOM_PRIVATE not found in env');

    const connection = new Connection(solanaUrl, 'confirmed');
    const provider = new JsonRpcProvider(proxyUrl);
    const neonProxyRpcApi = new NeonProxyRpcApi(proxyUrl);
    const solanaWallet = Keypair.fromSecretKey(decode(PHANTOM_PRIVATE));
    const neonWallet = new Wallet(NEON_PRIVATE, provider);

    const proxyStatus = await neonProxyRpcApi.evmParams();
    const gasTokens = await neonProxyRpcApi.nativeTokenList();
    const solToken = gasTokens.find(t => t.tokenName === 'SOL');
    
    if (!solToken) throw new Error('SOL token configuration not found');
    if (!proxyStatus.neonEvmProgramId) throw new Error('Neon EVM program ID not found');

    const neonEvmProgram = new PublicKey(proxyStatus.neonEvmProgramId);
    const chainId = parseInt(solToken.tokenChainId, 16);

    // Generate nullifier
    const nullifier = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);

    // Create contract interface and encode function call
    const tokenReceiverInterface = new Interface(TOKEN_RECEIVER_ABI);
    const data = tokenReceiverInterface.encodeFunctionData("receiveWithNullifier", [
        parseUnits(amount.toString(), 9),
        nullifier
    ]);

    // Create the EVM transaction data
    const evmTxData = {
        to: TOKEN_RECEIVER_CONTRACT,
        data,
        nonce: await neonWallet.getNonce(),
        value: "0x0",
        gasLimit: "0x5F5E100",
        gasPrice: "0x0",
        chainId
    };

    // Create and sign the raw transaction
    const rawTransaction = await neonWallet.signTransaction(evmTxData);

    // Create holder account
    const [holderAccount, holderSeed] = await holderAccountData(neonEvmProgram, solanaWallet.publicKey);

    // Create Solana transaction
    const transaction = new Transaction();
    
    // Add all required instructions in sequence
    transaction.add(
        createAccountWithSeedInstruction(solanaWallet.publicKey, holderSeed, holderAccount, neonEvmProgram),
        createHolderAccountInstruction(holderAccount, solanaWallet.publicKey, neonEvmProgram, holderSeed),
        await createExecFromDataInstruction({
            solanaWallet: solanaWallet.publicKey,
            neonWallet: neonWallet.address,
            holderAccount,
            neonEvmProgram,
            neonRawTransaction: rawTransaction,
            chainId
        }),
        createDeleteHolderInstruction(holderAccount, solanaWallet.publicKey, neonEvmProgram)
    );

    // Send the transaction through Solana
    const signature = await sendSolanaTransaction(
        connection,
        transaction,
        [toSigner(solanaWallet)],
        true
    );

    return {
        signature,
        nullifier: nullifier.toString(),
        amount
    };
}

// Test Implementation
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

        // Wait for bridge confirmation
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Test 2: Send to TokenReceiver through Solana
        console.log('Test 2: Sending to TokenReceiver contract through Solana');
        const contractResult = await sendToTokenReceiver(testAmount);
        console.assert(contractResult.signature, 'Should return a valid Solana signature');
        console.assert(contractResult.nullifier, 'Should return a valid nullifier');
        console.assert(contractResult.amount === testAmount, 'Amount should match');
        console.log('Contract transaction signature:', contractResult.signature);
        console.log('Nullifier:', contractResult.nullifier);
        console.log('Test 2 passed ✓');

        console.log('All tests passed! ✓');
    } catch (error) {
        console.error('Test failed:', error);
        throw error;
    }
}

// Run tests if this file is being run directly
if (require.main === module) {
    runTests().catch(console.error);
}

export { bridgeSOLToNeon, sendToTokenReceiver, TOKEN_RECEIVER_CONTRACT };