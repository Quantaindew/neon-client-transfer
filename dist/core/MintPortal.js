var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { InstructionService } from './InstructionService';
import { COMPUTE_BUDGET_ID, NEON_EVM_LOADER_ID, SPL_TOKEN_DEFAULT } from '../data';
import { etherToProgram, toBytesInt32, toFullAmount } from '../utils';
// ERC-20 tokens
export class MintPortal extends InstructionService {
    // #region Solana -> Neon
    createNeonTransfer(events = this.events, amount, splToken = SPL_TOKEN_DEFAULT) {
        return __awaiter(this, void 0, void 0, function* () {
            this.emitFunction(events.onBeforeCreateInstruction);
            const fullAmount = toFullAmount(amount, splToken.decimals);
            const computedBudgetProgram = new PublicKey(COMPUTE_BUDGET_ID);
            const solanaWallet = this.solanaWalletPubkey;
            const emulateSigner = this.solanaWalletSigner;
            const [neonAddress] = yield this.neonAccountAddress;
            const [accountPDA] = yield etherToProgram(emulateSigner.address);
            const computeBudgetUtilsInstruction = this.computeBudgetUtilsInstruction(computedBudgetProgram);
            const computeBudgetHeapFrameInstruction = this.computeBudgetHeapFrameInstruction(computedBudgetProgram);
            const { createApproveInstruction, associatedTokenAddress } = yield this.approveDepositInstruction(solanaWallet, accountPDA, splToken, amount);
            const { neonKeys, neonTransaction, nonce } = yield this.createClaimInstruction(solanaWallet, associatedTokenAddress, this.neonWalletAddress, splToken, emulateSigner, fullAmount);
            const { blockhash } = yield this.connection.getRecentBlockhash();
            const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: solanaWallet });
            // 0, 1, 2, 3
            transaction.add(computeBudgetUtilsInstruction);
            transaction.add(computeBudgetHeapFrameInstruction);
            transaction.add(createApproveInstruction);
            if (nonce === 0) {
                transaction.add(this.createAccountV3Instruction(solanaWallet, accountPDA, emulateSigner));
            }
            // 4
            if (neonTransaction === null || neonTransaction === void 0 ? void 0 : neonTransaction.rawTransaction) {
                transaction.add(yield this.makeTrExecFromDataIx(neonAddress, neonTransaction.rawTransaction, neonKeys));
            }
            this.emitFunction(events.onBeforeSignTransaction);
            try {
                const signedTransaction = yield this.solana.signTransaction(transaction);
                const sign = yield this.connection.sendRawTransaction(signedTransaction.serialize(), { skipPreflight: true });
                this.emitFunction(events.onSuccessSign, sign);
            }
            catch (e) {
                this.emitFunction(events.onErrorSign, e);
            }
        });
    }
    createAccountV3Instruction(solanaWallet, emulateSignerPDA, emulateSigner) {
        const a = new Buffer([40 /* EvmInstruction.CreateAccountV03 */]);
        const b = new Buffer(emulateSigner.address.slice(2), 'hex');
        const data = Buffer.concat([a, b]);
        return new TransactionInstruction({
            programId: new PublicKey(NEON_EVM_LOADER_ID),
            keys: [
                { pubkey: solanaWallet, isWritable: true, isSigner: true },
                { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
                { pubkey: emulateSignerPDA, isWritable: true, isSigner: false }
            ],
            data
        });
    }
    computeBudgetUtilsInstruction(programId) {
        const a = Buffer.from([0x00]);
        const b = Buffer.from(toBytesInt32(parseInt(this.proxyStatus.NEON_COMPUTE_UNITS)));
        const c = Buffer.from(toBytesInt32(0));
        const data = Buffer.concat([a, b, c]);
        return new TransactionInstruction({ programId, data, keys: [] });
    }
    computeBudgetHeapFrameInstruction(programId) {
        const a = new Buffer([0x01]);
        const b = Buffer.from(toBytesInt32(parseInt(this.proxyStatus.NEON_HEAP_FRAME)));
        const data = Buffer.concat([a, b]);
        return new TransactionInstruction({ programId, data, keys: [] });
    }
    createClaimInstruction(owner, from, to, splToken, emulateSigner, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            const nonce = yield this.web3.eth.getTransactionCount(emulateSigner.address);
            try {
                const claimTransaction = this.erc20ForSPLContract.methods.claimTo(from.toBytes(), to, amount).encodeABI();
                const transaction = {
                    nonce: nonce,
                    gas: `0x5F5E100`,
                    gasPrice: `0x0`,
                    from: this.neonWalletAddress,
                    to: splToken.address,
                    data: claimTransaction,
                    chainId: splToken.chainId
                };
                const signedTransaction = yield this.solanaWalletSigner.signTransaction(transaction);
                // @ts-ignore
                const neonEmulate = yield this.proxyApi.neonEmulate([signedTransaction.rawTransaction.slice(2)]);
                const accountsMap = new Map();
                if (neonEmulate) {
                    // @ts-ignore
                    for (const account of neonEmulate['accounts']) {
                        const key = account['account'];
                        accountsMap.set(key, { pubkey: new PublicKey(key), isSigner: false, isWritable: true });
                        if (account['contract']) {
                            const key = account['contract'];
                            accountsMap.set(key, { pubkey: new PublicKey(key), isSigner: false, isWritable: true });
                        }
                    }
                    // @ts-ignore
                    for (const account of neonEmulate['solana_accounts']) {
                        const key = account['pubkey'];
                        accountsMap.set(key, { pubkey: new PublicKey(key), isSigner: false, isWritable: true });
                    }
                }
                return {
                    neonKeys: Array.from(accountsMap.values()),
                    neonTransaction: signedTransaction,
                    emulateSigner,
                    nonce
                };
            }
            catch (e) {
                console.log(e);
            }
            // @ts-ignore
            return { neonKeys: [], neonTransaction: null, emulateSigner: null, nonce };
        });
    }
    makeTrExecFromDataIx(neonAddress, neonRawTransaction, neonKeys) {
        return __awaiter(this, void 0, void 0, function* () {
            const programId = new PublicKey(NEON_EVM_LOADER_ID);
            const count = 10;
            // const count = Number(this.proxyStatus.NEON_POOL_COUNT);
            const treasuryPoolIndex = Math.floor(Math.random() * count) % count;
            const treasuryPoolAddress = yield this.createCollateralPoolAddress(treasuryPoolIndex);
            const a = Buffer.from([31 /* EvmInstruction.TransactionExecuteFromData */]);
            const b = Buffer.from(toBytesInt32(treasuryPoolIndex));
            const c = Buffer.from(neonRawTransaction.slice(2), 'hex');
            const data = Buffer.concat([a, b, c]);
            const keys = [
                { pubkey: this.solanaWalletPubkey, isSigner: true, isWritable: true },
                { pubkey: treasuryPoolAddress, isSigner: false, isWritable: true },
                { pubkey: neonAddress, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: programId, isSigner: false, isWritable: false },
                ...neonKeys
            ];
            return new TransactionInstruction({ programId, keys, data });
        });
    }
    createCollateralPoolAddress(collateralPoolIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            const seed = `collateral_seed_${collateralPoolIndex}`;
            const collateralPoolBase = new PublicKey(this.proxyStatus.NEON_POOL_BASE);
            return PublicKey.createWithSeed(collateralPoolBase, seed, new PublicKey(NEON_EVM_LOADER_ID));
        });
    }
    createNeonTransaction(neonWallet, solanaWallet, splToken, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            const nonce = yield this.web3.eth.getTransactionCount(neonWallet);
            const fullAmount = toFullAmount(amount, splToken.decimals);
            const data = this.erc20ForSPLContract.methods.transferSolana(solanaWallet.toBytes(), fullAmount).encodeABI();
            const transaction = {
                nonce,
                from: neonWallet,
                to: splToken.address,
                data: data,
                value: `0x0`,
                chainId: splToken.chainId
            };
            const gasPrice = yield this.web3.eth.getGasPrice();
            const gas = yield this.web3.eth.estimateGas(transaction);
            transaction['gasPrice'] = gasPrice;
            transaction['gas'] = gas;
            return this.web3.eth.sendTransaction(transaction);
        });
    }
    // #endregion
    createSolanaTransfer(events = this.events, amount = 0, splToken = SPL_TOKEN_DEFAULT) {
        return __awaiter(this, void 0, void 0, function* () {
            const solanaWallet = this.solanaWalletAddress;
            const computedBudgetProgram = new PublicKey(COMPUTE_BUDGET_ID);
            const computeBudgetUtilsInstruction = this.computeBudgetUtilsInstruction(computedBudgetProgram);
            const computeBudgetHeapFrameInstruction = this.computeBudgetHeapFrameInstruction(computedBudgetProgram);
            const mintPubkey = new PublicKey(splToken.address_spl);
            const assocTokenAccountAddress = yield Token.getAssociatedTokenAddress(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mintPubkey, solanaWallet);
            const { blockhash } = yield this.connection.getRecentBlockhash();
            const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: solanaWallet });
            transaction.add(computeBudgetUtilsInstruction);
            transaction.add(computeBudgetHeapFrameInstruction);
            const createAccountInstruction = this.createAssociatedTokenAccountInstruction(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, mintPubkey, // token mint
            assocTokenAccountAddress, // account to create
            solanaWallet, // new account owner
            solanaWallet // payer
            );
            transaction.add(createAccountInstruction);
            this.emitFunction(events.onBeforeSignTransaction);
            try {
                const signedTransaction = yield this.solana.signTransaction(transaction);
                const sig = yield this.connection.sendRawTransaction(signedTransaction.serialize());
                const tr = yield this.createNeonTransaction(this.neonWalletAddress, assocTokenAccountAddress, splToken, amount);
                this.emitFunction(events.onSuccessSign, sig, tr.transactionHash);
            }
            catch (error) {
                this.emitFunction(events.onErrorSign, error);
            }
        });
    }
    // #region Neon -> Solana
    createAssociatedTokenAccountInstruction(associatedProgramId, programId, mint, associatedAccount, owner, payer) {
        const data = new Buffer([0x1]);
        const keys = [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: associatedAccount, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: programId, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
        ];
        return new TransactionInstruction({ keys, programId: associatedProgramId, data });
    }
}
//# sourceMappingURL=MintPortal.js.map