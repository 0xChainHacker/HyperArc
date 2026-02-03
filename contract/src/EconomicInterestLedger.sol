// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Ledger-based (non-transferable) economic interests for primary issuance.
contract EconomicInterestLedger is Ownable {
    using SafeERC20 for IERC20;

    struct Product {
        address issuer;        // issuer / SPV address (who can declare dividends)
        bool active;           // can subscribe when active
        bool frozen;           // owner can freeze to prevent issuer withdrawal (emergency)
        uint256 priceE6;       // price per 1 unit in USDC (6 decimals). e.g. 10 USDC => 10_000_000
        string metadataURI;    // optional off-chain metadata
    }

    IERC20 public immutable usdc; // USDC token on Arc
    uint256 public productCount;

    // productId => Product
    mapping(uint256 => Product) public products;

    // productId => investor => units (interest units, integer)
    mapping(uint256 => mapping(address => uint256)) private _holdings;

    // productId => total units
    mapping(uint256 => uint256) private _totalUnits;

    event ProductCreated(uint256 indexed productId, address indexed issuer, uint256 priceE6, string metadataURI);
    event ProductStatusUpdated(uint256 indexed productId, bool active, uint256 priceE6);
    event ProductFrozen(uint256 indexed productId, bool frozen);
    event Subscribed(uint256 indexed productId, address indexed investor, uint256 usdcPaidE6, uint256 unitsMinted);
    event SubscriptionFundsWithdrawn(uint256 indexed productId, address indexed issuer, uint256 amountE6);
    event Refunded(uint256 indexed productId, address indexed investor, uint256 unitsBurned, uint256 usdcRefundedE6);

    modifier onlyIssuer(uint256 productId) {
        require(products[productId].issuer == msg.sender, "not issuer");
        _;
    }

    constructor(address usdc_, address owner_) Ownable(owner_) {
        require(usdc_ != address(0), "USDC=0");
        usdc = IERC20(usdc_);
    }

    /// @notice Create a new economic interest product.
    /// @param issuer The issuer/SPV address responsible for distributions.
    /// @param priceE6 USDC(6 decimals) per unit. Must be > 0.
    /// @param metadataURI Optional product metadata (ipfs/https).
    function createProduct(address issuer, uint256 priceE6, string calldata metadataURI) external onlyOwner returns (uint256 productId) {
        require(issuer != address(0), "issuer=0");
        require(priceE6 > 0, "price=0");

        productId = ++productCount;
        products[productId] = Product({
            issuer: issuer,
            active: true,
            frozen: false,
            priceE6: priceE6,
            metadataURI: metadataURI
        });

        emit ProductCreated(productId, issuer, priceE6, metadataURI);
    }

    /// @notice Enable/disable product & update price.
    function setProduct(uint256 productId, bool active, uint256 priceE6) external {
        Product storage p = products[productId];
        require(p.issuer != address(0), "no product");

        // Only owner or issuer can update (MVP convenience)
        require(msg.sender == owner() || msg.sender == p.issuer, "not authorized");
        require(priceE6 > 0, "price=0");

        p.active = active;
        p.priceE6 = priceE6;

        emit ProductStatusUpdated(productId, active, priceE6);
    }

    /// @notice Owner can freeze/unfreeze product to prevent issuer withdrawal (emergency).
    /// @dev Frozen products cannot withdraw funds, but can still be refunded to protect investors.
    function freezeProduct(uint256 productId, bool frozen) external onlyOwner {
        Product storage p = products[productId];
        require(p.issuer != address(0), "no product");

        p.frozen = frozen;
        emit ProductFrozen(productId, frozen);
    }

    /// @notice Subscribe economic interests by paying USDC.
    /// @dev units = usdcAmount / pricePerUnit. Remainder stays with contract (or refund if you want).
    function subscribe(uint256 productId, uint256 usdcAmountE6) external returns (uint256 units) {
        Product memory p = products[productId];
        require(p.issuer != address(0), "no product");
        require(p.active, "inactive");
        require(usdcAmountE6 > 0, "amount=0");

        units = usdcAmountE6 / p.priceE6;
        require(units > 0, "too small");

        // pull USDC from investor
        usdc.safeTransferFrom(msg.sender, address(this), units * p.priceE6);

        _holdings[productId][msg.sender] += units;
        _totalUnits[productId] += units;

        emit Subscribed(productId, msg.sender, units * p.priceE6, units);
    }

    /// @notice Issuer withdraws subscription funds from treasury.
    /// @param productId The product ID
    /// @param amountE6 Amount of USDC to withdraw (6 decimals)
    function withdrawSubscriptionFunds(uint256 productId, uint256 amountE6) external onlyIssuer(productId) {
        require(amountE6 > 0, "amount=0");
        require(!products[productId].frozen, "product frozen");
        require(usdc.balanceOf(address(this)) >= amountE6, "insufficient balance");

        usdc.safeTransfer(msg.sender, amountE6);
        emit SubscriptionFundsWithdrawn(productId, msg.sender, amountE6);
    }

    /// @notice Issuer refunds investor by burning units and returning USDC.
    /// @param productId The product ID
    /// @param investor The investor address to refund
    /// @param units Number of units to burn and refund
    function refund(uint256 productId, address investor, uint256 units) external onlyIssuer(productId) {
        require(units > 0, "units=0");
        require(_holdings[productId][investor] >= units, "insufficient units");

        Product memory p = products[productId];
        uint256 refundAmountE6 = units * p.priceE6;
        require(usdc.balanceOf(address(this)) >= refundAmountE6, "insufficient balance");

        // Burn units
        _holdings[productId][investor] -= units;
        _totalUnits[productId] -= units;

        // Transfer USDC back to investor
        usdc.safeTransfer(investor, refundAmountE6);
        emit Refunded(productId, investor, units, refundAmountE6);
    }

    // ========= Read API =========

    function holdingOf(uint256 productId, address investor) external view returns (uint256) {
        return _holdings[productId][investor];
    }

    function totalUnits(uint256 productId) external view returns (uint256) {
        return _totalUnits[productId];
    }

    /// @notice Where subscription USDC sits (MVP). In production, you'd define treasury logic.
    function treasuryBalanceE6() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
