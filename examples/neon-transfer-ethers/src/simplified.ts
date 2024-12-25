import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createSyncNativeInstruction, createApproveInstruction } from '@solana/spl-token';
import { JsonRpcProvider, keccak256, Wallet, Interface, Contract } from 'ethers';
import { 
    NeonProxyRpcApi, 
    SPLToken, 
    createAccountBalanceForLegacyAccountInstruction,
    createExecFromDataInstructionV2,
    createClaimInstruction,
    authAccountAddress,
    holderAccountData,
    EvmInstruction
} from '@neonevm/token-transfer-core';
import { useTransactionFromSignerEthers, claimTransactionData } from '@neonevm/token-transfer-ethers';
import { decode } from 'bs58';
import { sendSolanaTransaction, toSigner } from './utils';
import { config } from 'dotenv';
config();

// Constants
const TOKEN_RECEIVER_CONTRACT = "0x1D1e8864997A2c684008539e780Df6934B6E4704";
const WSOL_TOKEN_ADDRESS = "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c";

// ABIs
const RECEIVER_ABI = [
    {
        "inputs": [
            { "name": "amount", "type": "uint256" },
            { "name": "nullifier", "type": "uint256" }
        ],
        "name": "receiveWithNullifier",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

// Helper function for holder account instruction
function createHolderAccountInstruction(neonEvmProgram: PublicKey, solanaWallet: PublicKey, holderAccount: PublicKey, seed: string) {
    const instruction = Buffer.from([EvmInstruction.HolderCreate]);
    const seedLength = Buffer.alloc(8);
    seedLength.writeUInt32LE(seed.length, 0);
    const seedBuffer = Buffer.from(seed, 'utf-8');
    const data = Buffer.concat([instruction, seedLength, seedBuffer]);

    const keys = [
        { pubkey: holderAccount, isSigner: false, isWritable: true },
        { pubkey: solanaWallet, isSigner: true, isWritable: false }
    ];

    return { programId: neonEvmProgram, keys, data };
}

// Token approval function
async function approveTokenSpending(amount: bigint) {
    if (!process.env.NEON_PRIVATE) throw new Error('NEON_PRIVATE not found in env');
    
    const provider = new JsonRpcProvider('https://devnet.neonevm.org/solana/sol');
    const wallet = new Wallet(process.env.NEON_PRIVATE, provider);
    
    const tokenContract = new Contract(WSOL_TOKEN_ADDRESS, ERC20_ABI, wallet);
    
    const currentAllowance = await tokenContract.allowance(wallet.address, TOKEN_RECEIVER_CONTRACT);
    
    if (currentAllowance < amount) {
        console.log(`Current allowance: ${currentAllowance}, approving ${amount}`);
        const tx = await tokenContract.approve(TOKEN_RECEIVER_CONTRACT, amount);
        await tx.wait();
        console.log(`Approval tx hash: ${tx.hash}`);
        return tx.hash;
    } else {
        console.log(`Allowance sufficient: ${currentAllowance} >= ${amount}`);
        return null;
    }
}

// Main bridge function
async function sendSOLWithNullifier(
    amount: number,
    receiverContract: string = TOKEN_RECEIVER_CONTRACT,
    nullifier: bigint = BigInt(Math.floor(Math.random() * 1000000))
) {
    // First approve token spending
    const lamports = BigInt(amount * Math.pow(10, 9));
    console.log("Approving token spending...");
    const approvalTx = await approveTokenSpending(lamports);
    if (approvalTx) {
        console.log("Waiting for approval confirmation...");
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const provider = new JsonRpcProvider('https://devnet.neonevm.org/solana/sol');
    const neonProxyRpcApi = new NeonProxyRpcApi('https://devnet.neonevm.org/solana/sol');
    
    if (!process.env.PHANTOM_PRIVATE) throw new Error('PHANTOM_PRIVATE not found in env');
    const solanaWallet = Keypair.fromSecretKey(decode(process.env.PHANTOM_PRIVATE));
    
    // Check balance first
    const walletBalance = await connection.getBalance(solanaWallet.publicKey);
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(128 * 1024);
    const solAmount = BigInt(amount * Math.pow(10, 9));

    if (walletBalance < Number(solAmount) + rentExemptBalance) {
        throw new Error(`Insufficient SOL. Need ${(Number(solAmount) + rentExemptBalance) / 1e9} SOL but have ${walletBalance / 1e9} SOL`);
    }
    
    const proxyStatus = await neonProxyRpcApi.evmParams();
    if (!proxyStatus.neonEvmProgramId) throw new Error('Neon EVM program ID not found');
    
    const neonEvmProgram = new PublicKey(proxyStatus.neonEvmProgramId);
    const gasTokens = await neonProxyRpcApi.nativeTokenList();
    const solToken = gasTokens.find(t => t.tokenName === 'SOL');
    if (!solToken) throw new Error('SOL token configuration not found');
    
    const chainId = parseInt(solToken.tokenChainId, 16);

    // Configure the SOL token
    const solTokenConfig: SPLToken = {
        chainId,
        address_spl: 'So11111111111111111111111111111111111111112',
        address: receiverContract,
        decimals: 9,
        name: 'SOL',
        symbol: 'SOL',
        logoURI: ''
    };

    // Create the transaction
    const transaction = new Transaction();
    const associatedTokenAddress = getAssociatedTokenAddressSync(
        new PublicKey(solTokenConfig.address_spl),
        solanaWallet.publicKey
    );

    // Create wallet signer for the bridge
    const walletSigner = new Wallet(
        keccak256(Buffer.from(`${receiverContract.slice(2)}${solanaWallet.publicKey.toBase58()}`, 'utf-8')),
        provider
    );

    // Get PDA for approval
    const [delegatePDA] = authAccountAddress(walletSigner.address, neonEvmProgram, solTokenConfig);
    const [holderAccount, holderSeed] = await holderAccountData(neonEvmProgram, solanaWallet.publicKey);

    // 1. Create holder account and initialize it
    transaction.add(
        SystemProgram.createAccountWithSeed({
            fromPubkey: solanaWallet.publicKey,
            newAccountPubkey: holderAccount,
            basePubkey: solanaWallet.publicKey,
            seed: holderSeed,
            lamports: rentExemptBalance,
            space: 128 * 1024,
            programId: neonEvmProgram
        })
    );
    
    // Initialize the holder account
    transaction.add(createHolderAccountInstruction(neonEvmProgram, solanaWallet.publicKey, holderAccount, holderSeed));

    // 2. Create wSOL account if needed
    const wSOLAccount = await connection.getAccountInfo(associatedTokenAddress);
    if (!wSOLAccount) {
        transaction.add(
            createAssociatedTokenAccountInstruction(
                solanaWallet.publicKey,
                associatedTokenAddress,
                solanaWallet.publicKey,
                new PublicKey(solTokenConfig.address_spl)
            )
        );
    }

    // 3. Transfer SOL to wSOL
    transaction.add(
        SystemProgram.transfer({
            fromPubkey: solanaWallet.publicKey,
            toPubkey: associatedTokenAddress,
            lamports: solAmount
        }),
        createSyncNativeInstruction(associatedTokenAddress)
    );

    // 4. Approve delegate
    transaction.add(
        createApproveInstruction(
            associatedTokenAddress,
            delegatePDA,
            solanaWallet.publicKey,
            solAmount
        )
    );

    // 5. Create the claim data with receiveWithNullifier encoding
    const receiverInterface = new Interface(RECEIVER_ABI);
    const methodData = receiverInterface.encodeFunctionData(
        "receiveWithNullifier",
        [solAmount, nullifier]
    );

    // 6. Create the claim data and signature
    const signedTransaction = await useTransactionFromSignerEthers(methodData, walletSigner, solTokenConfig.address);

    // 7. Create the claim instruction
    const { neonKeys, legacyAccounts } = await createClaimInstruction({
        proxyApi: neonProxyRpcApi,
        neonTransaction: signedTransaction,
        connection,
        neonEvmProgram,
        splToken: solTokenConfig,
        associatedTokenAddress,
        signerAddress: walletSigner.address,
        fullAmount: solAmount
    });

    // 8. Add legacy account instructions if any
    for (const account of legacyAccounts) {
        const instruction = await createAccountBalanceForLegacyAccountInstruction({
            connection,
            account,
            solanaWallet: solanaWallet.publicKey,
            neonEvmProgram,
            chainId
        });
        if (instruction) {
            transaction.add(instruction);
        }
    }

    // 9. Add the execution instruction
    transaction.add(
        createExecFromDataInstructionV2({
            solanaWallet: solanaWallet.publicKey,
            neonWallet: receiverContract,
            holderAccount,
            neonEvmProgram,
            neonRawTransaction: signedTransaction.rawTransaction,
            neonKeys,
            chainId,
            neonPoolCount: '128'
        })
    );

    // Send the transaction
    const signature = await sendSolanaTransaction(
        connection,
        transaction,
        [toSigner(solanaWallet)],
        true
    );

    return {
        signature,
        nullifier: nullifier.toString(),
        amount,
        receiverContract
    };
}

// Main execution
async function main() {
    try {
        const result = await sendSOLWithNullifier(0.1);
        console.log("Transaction completed:", result);
    } catch (error) {
        console.error("Error:", error);
    }
}

main();

export { sendSOLWithNullifier };