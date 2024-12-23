// index.ts
import { SPLToken } from '@neonevm/token-transfer-core';
import { transferNeonToNeon, transferNeonToSolana } from './neon';
import { convertAndBridgeSOLToNeon, transferERC20TokenToSolana } from './erc20';
import { delay } from './utils';

const tokensData = require('token-list/tokenlist.json');

const chainId = parseInt(`0xe9ac0ce`);
const supportedTokens = ['wSOL', 'SOL'];

const tokens = (tokensData?.tokens as SPLToken[] ?? [])
  .filter(t => t.chainId === chainId)
  .filter(t => supportedTokens.includes(t.symbol));
console.log(tokens);

(async function main() {
  const amount = 0.1;
  
  // Uncomment these if you want to transfer NEON tokens
  // await transferNeonToSolana(0.1);
  // await delay(10);
  // await transferNeonToNeon(0.1);
  // await delay(10);

  for (const token of tokens) {
    if (token.symbol === 'wSOL') {
      console.log('Converting SOL to wSOL and bridging to Neon EVM...');
      const signature = await convertAndBridgeSOLToNeon(token, amount);
      console.log('Transaction signature:', signature);
      await delay(10);
    }
    
    // Uncomment if you want to transfer from ERC20 back to Solana
    // await transferERC20TokenToSolana(token, 0.1);
    // await delay(10);
  }
})();