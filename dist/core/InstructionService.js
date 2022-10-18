var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import Big from 'big.js';
import { SHA256 } from 'crypto-js';
import { etherToProgram, toFullAmount } from '../utils';
import { erc20Abi, NEON_EVM_LOADER_ID, neonWrapperAbi } from '../data';
Big.PE = 42;
const noop = new Function();
export class InstructionService {
    constructor(options) {
        this.emitFunction = (functionName, ...args) => {
            if (typeof functionName === 'function') {
                functionName(...args);
            }
        };
        this.web3 = options.web3;
        this.proxyApi = options.proxyApi;
        this.proxyStatus = options.proxyStatus;
        this.solanaWalletAddress = options.solanaWalletAddress || '';
        this.neonWalletAddress = options.neonWalletAddress || '';
        this.connection = options.connection;
        this.events = {
            onBeforeCreateInstruction: options.onBeforeCreateInstruction || noop,
            onCreateNeonAccountInstruction: options.onCreateNeonAccountInstruction || noop,
            onBeforeSignTransaction: options.onBeforeSignTransaction || noop,
            onBeforeNeonSign: options.onBeforeNeonSign || noop,
            onSuccessSign: options.onSuccessSign || noop,
            onErrorSign: options.onErrorSign || noop
        };
    }
    get erc20ForSPLContract() {
        return new this.web3.eth.Contract(erc20Abi);
    }
    get neonWrapperContract() {
        return new this.web3.eth.Contract(neonWrapperAbi);
    }
    get solana() {
        if ('solana' in window) {
            return window['solana'];
        }
        return {};
    }
    get solanaWalletPubkey() {
        return new PublicKey(this.solanaWalletAddress);
    }
    get solanaWalletSigner() {
        const solanaWallet = this.solanaWalletPubkey.toBase58();
        const neonWallet = this.neonWalletAddress;
        const emulateSignerPrivateKey = `0x${SHA256(solanaWallet + neonWallet).toString()}`;
        return this.web3.eth.accounts.privateKeyToAccount(emulateSignerPrivateKey);
    }
    get neonAccountAddress() {
        return etherToProgram(this.neonWalletAddress);
    }
    getNeonAccount(neonAssociatedKey) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.connection.getAccountInfo(neonAssociatedKey);
        });
    }
    neonAccountInstruction() {
        return __awaiter(this, void 0, void 0, function* () {
            const [neonAddress, neonNonce] = yield this.neonAccountAddress;
            const keys = [
                { pubkey: this.solanaWalletPubkey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: neonAddress, isSigner: false, isWritable: true }
            ];
            const a = new Buffer([24 /* EvmInstruction.CreateAccountV02 */]);
            const b = Buffer.from(this.neonWalletAddress, 'hex');
            const c = new Buffer([neonNonce]);
            const data = Buffer.concat([a, b, c]);
            return new TransactionInstruction({
                programId: new PublicKey(NEON_EVM_LOADER_ID),
                data,
                keys
            });
        });
    }
    approveDepositInstruction(solanaPubkey, neonPDAPubkey, token, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            const fullAmount = toFullAmount(amount, token.decimals);
            const associatedTokenAddress = yield Token.getAssociatedTokenAddress(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, new PublicKey(token.address_spl), solanaPubkey);
            const createApproveInstruction = Token.createApproveInstruction(TOKEN_PROGRAM_ID, associatedTokenAddress, neonPDAPubkey, solanaPubkey, [], Number(fullAmount.toString(10)));
            return { associatedTokenAddress, createApproveInstruction };
        });
    }
    _computeWithdrawEthTransactionData(amount, splToken) {
        const approveSolanaMethodID = '0x93e29346';
        const solanaPubkey = this.solanaWalletPubkey;
        // @ts-ignore
        const solanaStr = solanaPubkey.toBytes().toString('hex');
        const amountUnit = Big(amount).times(Big(10).pow(splToken.decimals));
        // @ts-ignore
        const amountStr = BigInt(amountUnit).toString(16).padStart(64, '0');
        return `${approveSolanaMethodID}${solanaStr}${amountStr}`;
    }
    createApproveSolanaData(solanaWallet, splToken, amount) {
        const fullAmount = toFullAmount(amount, splToken.decimals);
        return this.erc20ForSPLContract.methods.approveSolana(solanaWallet.toBytes(), fullAmount).encodeABI();
    }
    getEthereumTransactionParams(amount, token) {
        const solanaWallet = this.solanaWalletPubkey;
        return {
            to: token.address,
            from: this.neonWalletAddress,
            value: '0x00',
            data: this.createApproveSolanaData(solanaWallet, token, amount)
        };
    }
}
//# sourceMappingURL=InstructionService.js.map