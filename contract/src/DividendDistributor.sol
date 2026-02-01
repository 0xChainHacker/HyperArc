// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DividendDistributor
 * @notice Automated dividend distribution system
 */
contract DividendDistributor is Ownable {
    IERC20 public usdc;
    
    struct DividendPool {
        uint256 totalDividend;
        uint256 accDividendPerShare;
        uint256 lastUpdateTime;
    }
    
    mapping(uint256 => DividendPool) public dividendPools;
    mapping(uint256 => mapping(address => uint256)) public rewardDebt;
    mapping(uint256 => mapping(address => uint256)) public pendingRewards;
    
    event DividendDeclared(uint256 indexed productId, uint256 amount);
    event Claimed(uint256 indexed productId, address indexed investor, uint256 amount);
    
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }
    
    function declareDividend(uint256 productId, uint256 amount, uint256 totalShares) external onlyOwner {
        require(amount > 0, "Amount must be positive");
        require(totalShares > 0, "No shares");
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        
        DividendPool storage pool = dividendPools[productId];
        pool.totalDividend += amount;
        pool.accDividendPerShare += (amount * 1e18) / totalShares;
        pool.lastUpdateTime = block.timestamp;
        
        emit DividendDeclared(productId, amount);
    }
    
    function claim(uint256 productId, uint256 holdings) external {
        DividendPool storage pool = dividendPools[productId];
        
        uint256 pending = (holdings * pool.accDividendPerShare / 1e18) - rewardDebt[productId][msg.sender];
        
        if (pending > 0) {
            rewardDebt[productId][msg.sender] = holdings * pool.accDividendPerShare / 1e18;
            require(usdc.transfer(msg.sender, pending), "USDC transfer failed");
            emit Claimed(productId, msg.sender, pending);
        }
    }
    
    function pendingDividend(uint256 productId, uint256 holdings, address investor) external view returns (uint256) {
        DividendPool storage pool = dividendPools[productId];
        return (holdings * pool.accDividendPerShare / 1e18) - rewardDebt[productId][investor];
    }
}
