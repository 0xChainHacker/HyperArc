// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EconomicInterestLedger
 * @notice Primary issuance and ledger for economic interests
 */
contract EconomicInterestLedger is Ownable {
    IERC20 public usdc;
    
    struct Product {
        uint256 id;
        string name;
        uint256 pricePerUnit;
        uint256 totalSupply;
        bool active;
    }
    
    mapping(uint256 => Product) public products;
    mapping(uint256 => mapping(address => uint256)) public holdings;
    mapping(uint256 => uint256) public totalHoldings;
    
    uint256 public nextProductId;
    
    event ProductCreated(uint256 indexed productId, string name, uint256 pricePerUnit);
    event Subscribed(uint256 indexed productId, address indexed investor, uint256 amount, uint256 usdcPaid);
    
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        nextProductId = 1;
    }
    
    function createProduct(
        string memory name,
        uint256 pricePerUnit,
        uint256 totalSupply
    ) external onlyOwner returns (uint256) {
        uint256 productId = nextProductId++;
        
        products[productId] = Product({
            id: productId,
            name: name,
            pricePerUnit: pricePerUnit,
            totalSupply: totalSupply,
            active: true
        });
        
        emit ProductCreated(productId, name, pricePerUnit);
        return productId;
    }
    
    function subscribe(uint256 productId, uint256 amount) external {
        Product storage product = products[productId];
        require(product.active, "Product not active");
        require(totalHoldings[productId] + amount <= product.totalSupply, "Exceeds supply");
        
        uint256 usdcAmount = amount * product.pricePerUnit;
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        
        holdings[productId][msg.sender] += amount;
        totalHoldings[productId] += amount;
        
        emit Subscribed(productId, msg.sender, amount, usdcAmount);
    }
    
    function getHolding(uint256 productId, address investor) external view returns (uint256) {
        return holdings[productId][investor];
    }
}
