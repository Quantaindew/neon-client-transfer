// First install: npm install bs58

const bs58 = require('bs58');

function splAddressToBytes32(splAddress) {
    try {
        // Decode the base58 address
        const decoded = bs58.decode(splAddress);
        
        // SPL addresses are 32 bytes, but let's verify
        if (decoded.length !== 32) {
            throw new Error(`Invalid SPL address length: ${decoded.length} bytes. Expected 32 bytes.`);
        }
        
        // Convert to hex string with '0x' prefix
        const bytes32 = '0x' + Buffer.from(decoded).toString('hex');
        
        return bytes32;
    } catch (error) {
        throw new Error(`Error converting SPL address: ${error.message}`);
    }
}

// Example usage
const splAddress = "So11111111111111111111111111111111111111112";

try {
    const bytes32 = splAddressToBytes32(splAddress);
    console.log('Original SPL address:', splAddress);
    console.log('Converted to bytes32:', bytes32);
} catch (error) {
    console.error('Conversion error:', error.message);
}

// Verification function (optional)
function verifyBytes32(bytes32) {
    // Remove '0x' prefix if present
    const hex = bytes32.startsWith('0x') ? bytes32.slice(2) : bytes32;
    
    // Check length (32 bytes = 64 hex characters)
    if (hex.length !== 64) {
        throw new Error(`Invalid bytes32 length: ${hex.length/2} bytes. Expected 32 bytes.`);
    }
    
    // Verify it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error('Invalid hex characters detected');
    }
    
    return true;
}