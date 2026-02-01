// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IEconomicInterestLedger {
    function products(uint256 productId) external view returns (address issuer, bool active, uint256 priceE6, string memory metadataURI);
    function holdingOf(uint256 productId, address investor) external view returns (uint256);
    function totalUnits(uint256 productId) external view returns (uint256);
}

/// @notice Claim-based dividend distribution for ledger-based economic interests.
contract DividendDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IEconomicInterestLedger public immutable ledger;

    // productId => accDividendPerShare (scaled by 1e18)
    mapping(uint256 => uint256) public accDividendPerShare;

    // productId => user => rewardDebt (scaled)
    mapping(uint256 => mapping(address => uint256)) public rewardDebt;

    event DividendDeclared(uint256 indexed productId, address indexed issuer, uint256 amountE6, uint256 accDividendPerShareNew);
    event Claimed(uint256 indexed productId, address indexed investor, uint256 amountE6);

    constructor(address usdc_, address ledger_) {
        require(usdc_ != address(0) && ledger_ != address(0), "zero addr");
        usdc = IERC20(usdc_);
        ledger = IEconomicInterestLedger(ledger_);
    }

    modifier onlyIssuer(uint256 productId) {
        (address issuer,,,) = ledger.products(productId);
        require(msg.sender == issuer, "not issuer");
        _;
    }

    /// @notice Issuer funds USDC dividends for a product.
    /// @dev Pulls USDC from issuer. Requires issuer approve() first.
    function declareDividend(uint256 productId, uint256 amountE6) external onlyIssuer(productId) {
        require(amountE6 > 0, "amount=0");

        uint256 total = ledger.totalUnits(productId);
        require(total > 0, "no holders");

        // pull USDC into this contract as dividend pool
        usdc.safeTransferFrom(msg.sender, address(this), amountE6);

        // update accumulator (scaled by 1e18)
        accDividendPerShare[productId] += (amountE6 * 1e18) / total;

        emit DividendDeclared(productId, msg.sender, amountE6, accDividendPerShare[productId]);
    }

    /// @notice Pending dividend in USDC(6 decimals) for investor.
    function pending(uint256 productId, address investor) public view returns (uint256 pendingE6) {
        uint256 units = ledger.holdingOf(productId, investor);
        if (units == 0) return 0;

        uint256 acc = accDividendPerShare[productId];
        uint256 accrued = (units * acc) / 1e18; // in USDC 6 decimals
        uint256 debt = rewardDebt[productId][investor];
        if (accrued <= debt) return 0;

        pendingE6 = accrued - debt;
    }

    /// @notice Claim dividend for msg.sender.
    function claim(uint256 productId) external nonReentrant returns (uint256 claimedE6) {
        uint256 units = ledger.holdingOf(productId, msg.sender);
        require(units > 0, "no units");

        uint256 acc = accDividendPerShare[productId];
        uint256 accrued = (units * acc) / 1e18;
        uint256 debt = rewardDebt[productId][msg.sender];

        require(accrued > debt, "nothing to claim");
        claimedE6 = accrued - debt;

        // update debt to current accrued amount
        rewardDebt[productId][msg.sender] = accrued;

        usdc.safeTransfer(msg.sender, claimedE6);
        emit Claimed(productId, msg.sender, claimedE6);
    }

    /// @notice (Optional) If you ever allow holdings to increase after dividends, user should call this before subscribe.
    /// MVP can ignore if you keep flows simple, but it’s good for safety in integrations.
    function syncRewardDebt(uint256 productId, address investor) external {
        uint256 units = ledger.holdingOf(productId, investor);
        uint256 acc = accDividendPerShare[productId];
        rewardDebt[productId][investor] = (units * acc) / 1e18;
    }
}
