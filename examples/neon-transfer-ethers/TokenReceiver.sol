// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TokenReceiver {
    address public owner;
    IERC20 public constant TOKEN = IERC20(0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c);
    
    // Struct to store transfer details with nullifier
    struct Transfer {
        uint256 amount;
        uint256 timestamp;
        uint256 nullifier;
    }
    
    // Mapping from sender address to their latest transfer
    mapping(address => Transfer) public latestTransfers;
    
    // Events
    event TokenReceived(address indexed sender, uint256 amount, uint256 timestamp, uint256 nullifier);
    event TokenWithdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    // Constructor
    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }
    
    // Function to receive tokens with nullifier
    function receiveWithNullifier(uint256 amount, uint256 nullifier) external {
        require(TOKEN.transferFrom(tx.origin, address(this), amount), "Transfer failed");
        
        // Record the transfer with nullifier using tx.origin instead of msg.sender
        latestTransfers[tx.origin] = Transfer({
            amount: amount,
            timestamp: block.timestamp,
            nullifier: nullifier
        });
        
        // Emit event with tx.origin as the sender
        emit TokenReceived(tx.origin, amount, block.timestamp, nullifier);
    }
    
    // Function to get latest transfer details
    function getLatestTransfer(address sender) external view returns (uint256 amount, uint256 timestamp, uint256 nullifier) {
        Transfer memory transfer = latestTransfers[sender];
        return (transfer.amount, transfer.timestamp, transfer.nullifier);
    }
    
    // Withdrawal functions
    function withdraw() external onlyOwner {
        uint256 balance = TOKEN.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        
        require(TOKEN.transfer(owner, balance), "Withdrawal failed");
        
        emit TokenWithdrawn(owner, balance);
    }
    
    function withdrawTo(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        uint256 balance = TOKEN.balanceOf(address(this));
        require(amount <= balance, "Insufficient balance");
        
        require(TOKEN.transfer(to, amount), "Withdrawal failed");
        
        emit TokenWithdrawn(to, amount);
    }
    
    // Emergency drain
    function drain() external onlyOwner {
        uint256 balance = TOKEN.balanceOf(address(this));
        require(balance > 0, "No tokens to drain");
        
        require(TOKEN.transfer(owner, balance), "Drain failed");
        
        emit TokenWithdrawn(owner, balance);
    }
    
    // Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    
    // View functions
    function getBalance() external view returns (uint256) {
        return TOKEN.balanceOf(address(this));
    }
}