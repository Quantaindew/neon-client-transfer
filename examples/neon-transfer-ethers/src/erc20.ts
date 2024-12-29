// erc20.ts
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
  return signature;
}

export async function convertAndBridgeSOLToNeon(
  token: SPLToken, 
  amount: number,
  receivingAddress: string // New parameter for the receiving address
): Promise<string> {
  // First check SOL balance
  const walletBalance = await connection.getBalance(solanaWallet.publicKey);
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(0);
  
  if (walletBalance < amount * 1e9 + rentExemptBalance) {
    throw new Error('Insufficient SOL balance');
  }

  const associatedTokenAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    solanaWallet.publicKey
  );

  // Create single transaction for both operations
  const transaction = new Transaction();
  
  // Check if token account exists and create if needed
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

  // Add SOL to wSOL conversion instructions
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: solanaWallet.publicKey,
      toPubkey: associatedTokenAccount,
      lamports: amount * 1e9
    }),
    createSyncNativeInstruction(associatedTokenAccount)
  );

  // Create a temporary wallet signer using the receiving address
  const walletSigner = new Wallet(
    keccak256(Buffer.from(`${receivingAddress.slice(2)}${solanaWallet.publicKey.toBase58()}`, 'utf-8')), 
    provider
  );

  // Add bridge instructions using the receiving address
  const bridgeInstructions = await neonTransferMintTransactionEthers({
    connection,
    proxyApi: neonProxyRpcApi,
    neonEvmProgram,
    solanaWallet: solanaWallet.publicKey,
    neonWallet: receivingAddress, // Use the provided receiving address
    walletSigner,
    splToken: token,
    amount,
    chainId
  });

  // Add bridge instructions to the same transaction
  transaction.add(...bridgeInstructions.instructions);

  // Send the combined transaction
  const signature = await sendSolanaTransaction(connection, transaction, [toSigner(solanaWallet)], true);
  return signature;
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
  return hash;
}

export const erc20Abi = [
  {
    'inputs': [
      {
        'internalType': 'string',
        'name': '_name',
        'type': 'string'
      },
      {
        'internalType': 'string',
        'name': '_symbol',
        'type': 'string'
      },
      {
        'internalType': 'bytes32',
        'name': '_tokenMint',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'constructor'
  },
  {
    'anonymous': false,
    'inputs': [
      {
        'indexed': true,
        'internalType': 'address',
        'name': 'owner',
        'type': 'address'
      },
      {
        'indexed': true,
        'internalType': 'address',
        'name': 'spender',
        'type': 'address'
      },
      {
        'indexed': false,
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'Approval',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      {
        'indexed': true,
        'internalType': 'address',
        'name': 'owner',
        'type': 'address'
      },
      {
        'indexed': true,
        'internalType': 'bytes32',
        'name': 'spender',
        'type': 'bytes32'
      },
      {
        'indexed': false,
        'internalType': 'uint64',
        'name': 'amount',
        'type': 'uint64'
      }
    ],
    'name': 'ApprovalSolana',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      {
        'indexed': true,
        'internalType': 'address',
        'name': 'from',
        'type': 'address'
      },
      {
        'indexed': true,
        'internalType': 'address',
        'name': 'to',
        'type': 'address'
      },
      {
        'indexed': false,
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'Transfer',
    'type': 'event'
  },
  {
    'anonymous': false,
    'inputs': [
      {
        'indexed': true,
        'internalType': 'address',
        'name': 'from',
        'type': 'address'
      },
      {
        'indexed': true,
        'internalType': 'bytes32',
        'name': 'to',
        'type': 'bytes32'
      },
      {
        'indexed': false,
        'internalType': 'uint64',
        'name': 'amount',
        'type': 'uint64'
      }
    ],
    'name': 'TransferSolana',
    'type': 'event'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'owner',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': 'spender',
        'type': 'address'
      }
    ],
    'name': 'allowance',
    'outputs': [
      {
        'internalType': 'uint256',
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'spender',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'approve',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'bytes32',
        'name': 'spender',
        'type': 'bytes32'
      },
      {
        'internalType': 'uint64',
        'name': 'amount',
        'type': 'uint64'
      }
    ],
    'name': 'approveSolana',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'who',
        'type': 'address'
      }
    ],
    'name': 'balanceOf',
    'outputs': [
      {
        'internalType': 'uint256',
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'burn',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'from',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'burnFrom',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'bytes32',
        'name': 'from',
        'type': 'bytes32'
      },
      {
        'internalType': 'uint64',
        'name': 'amount',
        'type': 'uint64'
      }
    ],
    'name': 'claim',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'bytes32',
        'name': 'from',
        'type': 'bytes32'
      },
      {
        'internalType': 'uint256',
        'name': 'to',
        'type': 'nullifier'
      },
      {
        'internalType': 'uint64',
        'name': 'amount',
        'type': 'uint64'
      }
    ],
    'name': 'claimTo',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'decimals',
    'outputs': [
      {
        'internalType': 'uint8',
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'name',
    'outputs': [
      {
        'internalType': 'string',
        'name': '',
        'type': 'string'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'symbol',
    'outputs': [
      {
        'internalType': 'string',
        'name': '',
        'type': 'string'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'tokenMint',
    'outputs': [
      {
        'internalType': 'bytes32',
        'name': '',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'totalSupply',
    'outputs': [
      {
        'internalType': 'uint256',
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'to',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'transfer',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'from',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': 'to',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'transferFrom',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'bytes32',
        'name': 'to',
        'type': 'bytes32'
      },
      {
        'internalType': 'uint64',
        'name': 'amount',
        'type': 'uint64'
      }
    ],
    'name': 'transferSolana',
    'outputs': [
      {
        'internalType': 'bool',
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }
];

export default erc20Abi;
