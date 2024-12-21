// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

contract ETHReceiver {
    address public owner;
    
    // Struct to store transfer details with nullifier
    struct Transfer {
        uint256 amount;
        uint256 timestamp;
        uint256 nullifier; // Added nullifier field
    }
    
    // Mapping from sender address to their latest transfer
    mapping(address => Transfer) public latestTransfers;
    
    // Events
    event ETHReceived(address indexed sender, uint256 amount, uint256 timestamp, uint256 nullifier);
    event ETHWithdrawn(address indexed to, uint256 amount);
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
    
    // Function to receive ETH with nullifier
    function receiveWithNullifier(uint256 nullifier) external payable {
        // Record the transfer with nullifier
        latestTransfers[msg.sender] = Transfer({
            amount: msg.value,
            timestamp: block.timestamp,
            nullifier: nullifier
        });
        
        // Emit event
        emit ETHReceived(msg.sender, msg.value, block.timestamp, nullifier);
    }
    
    // Fallback function to receive ETH
    receive() external payable {
        // Record the transfer with zero nullifier for backward compatibility
        latestTransfers[msg.sender] = Transfer({
            amount: msg.value,
            timestamp: block.timestamp,
            nullifier: 0
        });
        
        // Emit event
        emit ETHReceived(msg.sender, msg.value, block.timestamp, 0);
    }
    
    // Function to get latest transfer details
    function getLatestTransfer(address sender) external view returns (uint256 amount, uint256 timestamp, uint256 nullifier) {
        Transfer memory transfer = latestTransfers[sender];
        return (transfer.amount, transfer.timestamp, transfer.nullifier);
    }
    
    // Withdrawal functions
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        
        (bool success, ) = owner.call{value: balance}("");
        require(success, "Withdrawal failed");
        
        emit ETHWithdrawn(owner, balance);
    }
    
    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(amount <= address(this).balance, "Insufficient balance");
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "Withdrawal failed");
        
        emit ETHWithdrawn(to, amount);
    }
    
    // Emergency drain
    function drain() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to drain");
        
        (bool success, ) = owner.call{value: balance}("");
        require(success, "Drain failed");
        
        emit ETHWithdrawn(owner, balance);
    }
    
    // Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    
    // View functions
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
