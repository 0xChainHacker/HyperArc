// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {EconomicInterestLedger} from "../src/EconomicInterestLedger.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock USDC token for testing purposes
/// @dev Implements basic ERC20 functionality without full compliance checks
contract MockUSDC is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

/// @notice Test suite for EconomicInterestLedger contract
/// @dev Tests product creation, subscription, and ledger management
contract EconomicInterestLedgerTest is Test {
    EconomicInterestLedger public ledger;
    MockUSDC public usdc;
    
    // Test accounts
    address public owner = address(0x1);      // Ledger contract owner
    address public issuer = address(0x2);     // Product issuer/SPV
    address public investor1 = address(0x3);  // First investor
    address public investor2 = address(0x4);  // Second investor
    
    uint256 constant PRICE_PER_UNIT = 10_000_000; // 10 USDC (6 decimals)
    
    event ProductCreated(uint256 indexed productId, address indexed issuer, uint256 priceE6, string metadataURI);
    event ProductStatusUpdated(uint256 indexed productId, bool active, uint256 priceE6);
    event ProductFrozen(uint256 indexed productId, bool frozen);
    event Subscribed(uint256 indexed productId, address indexed investor, uint256 usdcPaidE6, uint256 unitsMinted);
    event SubscriptionFundsWithdrawn(uint256 indexed productId, address indexed issuer, uint256 amountE6);
    event Refunded(uint256 indexed productId, address indexed investor, uint256 unitsBurned, uint256 usdcRefundedE6);

    /// @notice Set up test environment before each test
    /// @dev Deploys contracts and funds investors with USDC
    function setUp() public {
        // Deploy mock USDC token
        usdc = new MockUSDC();
        
        // Deploy ledger contract with owner
        vm.prank(owner);
        ledger = new EconomicInterestLedger(address(usdc), owner);
        
        // Fund investors with USDC for subscriptions
        usdc.mint(investor1, 1000_000_000); // 1000 USDC
        usdc.mint(investor2, 1000_000_000); // 1000 USDC
    }

    /// @notice Test successful product creation by owner
    /// @dev Verifies product ID, count, and all product attributes
    function testCreateProduct() public {
        // Owner creates a new product
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit ProductCreated(1, issuer, PRICE_PER_UNIT, "ipfs://test");
        
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Verify product ID starts at 1
        assertEq(productId, 1);
        assertEq(ledger.productCount(), 1);
        
        // Verify all product attributes are correctly stored
        (address _issuer, bool active, bool frozen, uint256 price, string memory uri) = ledger.products(1);
        assertEq(_issuer, issuer);
        assertTrue(active);
        assertFalse(frozen);
        assertEq(price, PRICE_PER_UNIT);
        assertEq(uri, "ipfs://test");
    }

    /// @notice Test that only owner can create products
    /// @dev Non-owner should be reverted by Ownable modifier
    function testCreateProductOnlyOwner() public {
        vm.prank(investor1);
        vm.expectRevert();
        ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
    }

    /// @notice Test that issuer address cannot be zero
    /// @dev Should revert with "issuer=0" error
    function testCreateProductZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("issuer=0");
        ledger.createProduct(address(0), PRICE_PER_UNIT, "ipfs://test");
    }

    /// @notice Test that price must be greater than zero
    /// @dev Should revert with "price=0" error
    function testCreateProductZeroPrice() public {
        vm.prank(owner);
        vm.expectRevert("price=0");
        ledger.createProduct(issuer, 0, "ipfs://test");
    }

    /// @notice Test that issuer can update product status and price
    /// @dev Issuer should be able to deactivate and change price
    function testSetProduct() public {
        // Create initial product
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        uint256 newPrice = 20_000_000; // 20 USDC
        
        // Issuer updates product to inactive with new price
        vm.prank(issuer);
        vm.expectEmit(true, false, false, true);
        emit ProductStatusUpdated(productId, false, newPrice);
        ledger.setProduct(productId, false, newPrice);
        
        // Verify changes applied
        (, bool active,, uint256 price,) = ledger.products(productId);
        assertFalse(active);
        assertEq(price, newPrice);
    }

    function testSetProductByOwner() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.prank(owner);
        ledger.setProduct(productId, false, 15_000_000);
        
        (, bool active,,,) = ledger.products(productId);
        assertFalse(active);
    }

    function testSetProductUnauthorized() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.prank(investor1);
        vm.expectRevert("not authorized");
        ledger.setProduct(productId, false, 15_000_000);
    }

    /// @notice Test successful subscription to a product
    /// @dev Investor pays USDC and receives units in the ledger
    function testSubscribe() public {
        // Create product
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        uint256 usdcAmount = 100_000_000; // 100 USDC
        uint256 expectedUnits = usdcAmount / PRICE_PER_UNIT; // 10 units
        
        // Investor1 subscribes to product
        vm.startPrank(investor1);
        usdc.approve(address(ledger), usdcAmount);
        
        vm.expectEmit(true, true, false, true);
        emit Subscribed(productId, investor1, expectedUnits * PRICE_PER_UNIT, expectedUnits);
        
        uint256 units = ledger.subscribe(productId, usdcAmount);
        vm.stopPrank();
        
        // Verify units minted and USDC transferred
        assertEq(units, expectedUnits);
        assertEq(ledger.holdingOf(productId, investor1), expectedUnits);
        assertEq(ledger.totalUnits(productId), expectedUnits);
        assertEq(usdc.balanceOf(address(ledger)), expectedUnits * PRICE_PER_UNIT);
    }

    /// @notice Test multiple investors subscribing to the same product
    /// @dev Verifies independent holdings and correct total units calculation
    function testSubscribeMultipleInvestors() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor 1 subscribes with 100 USDC -> 10 units
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        uint256 units1 = ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Investor 2 subscribes with 200 USDC -> 20 units
        vm.startPrank(investor2);
        usdc.approve(address(ledger), 200_000_000);
        uint256 units2 = ledger.subscribe(productId, 200_000_000);
        vm.stopPrank();
        
        // Verify individual holdings and total
        assertEq(units1, 10);
        assertEq(units2, 20);
        assertEq(ledger.holdingOf(productId, investor1), 10);
        assertEq(ledger.holdingOf(productId, investor2), 20);
        assertEq(ledger.totalUnits(productId), 30);
    }

    function testSubscribeInactiveProduct() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.prank(issuer);
        ledger.setProduct(productId, false, PRICE_PER_UNIT);
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        vm.expectRevert("inactive");
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
    }

    function testSubscribeNonexistentProduct() public {
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        vm.expectRevert("no product");
        ledger.subscribe(999, 100_000_000);
        vm.stopPrank();
    }

    function testSubscribeTooSmallAmount() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 1_000_000); // 1 USDC (less than price per unit)
        vm.expectRevert("too small");
        ledger.subscribe(productId, 1_000_000);
        vm.stopPrank();
    }

    function testSubscribeZeroAmount() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        vm.expectRevert("amount=0");
        ledger.subscribe(productId, 0);
        vm.stopPrank();
    }

    function testTreasuryBalance() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        assertEq(ledger.treasuryBalanceE6(), 100_000_000);
    }

    function testMultipleProducts() public {
        vm.startPrank(owner);
        uint256 productId1 = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://product1");
        uint256 productId2 = ledger.createProduct(issuer, 5_000_000, "ipfs://product2");
        vm.stopPrank();
        
        assertEq(productId1, 1);
        assertEq(productId2, 2);
        assertEq(ledger.productCount(), 2);
        
        // Subscribe to both products
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 200_000_000);
        ledger.subscribe(productId1, 100_000_000); // 10 units at 10 USDC each
        ledger.subscribe(productId2, 100_000_000); // 20 units at 5 USDC each
        vm.stopPrank();
        
        assertEq(ledger.holdingOf(productId1, investor1), 10);
        assertEq(ledger.holdingOf(productId2, investor1), 20);
    }

    /// @notice Test owner can freeze a product
    function testFreezeProduct() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Owner freezes product
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit ProductFrozen(productId, true);
        ledger.freezeProduct(productId, true);
        
        // Verify frozen
        (,, bool frozen,,) = ledger.products(productId);
        assertTrue(frozen);
    }

    /// @notice Test only owner can freeze products
    function testFreezeProductOnlyOwner() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Issuer tries to freeze
        vm.prank(issuer);
        vm.expectRevert();
        ledger.freezeProduct(productId, true);
        
        // Investor tries to freeze
        vm.prank(investor1);
        vm.expectRevert();
        ledger.freezeProduct(productId, true);
    }

    /// @notice Test freeze prevents issuer from withdrawing funds
    function testFreezeProductPreventsWithdrawal() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor subscribes
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Owner freezes product
        vm.prank(owner);
        ledger.freezeProduct(productId, true);
        
        // Issuer tries to withdraw
        vm.prank(issuer);
        vm.expectRevert("product frozen");
        ledger.withdrawSubscriptionFunds(productId, 50_000_000);
    }

    /// @notice Test frozen product can still refund investors
    function testFreezeProductAllowsRefund() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor subscribes
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Owner freezes product
        vm.prank(owner);
        ledger.freezeProduct(productId, true);
        
        // Issuer can still refund
        vm.prank(issuer);
        ledger.refund(productId, investor1, 5);
        
        // Verify refund succeeded
        assertEq(ledger.holdingOf(productId, investor1), 5);
    }

    /// @notice Test unfreezing allows withdrawal again
    function testUnfreezeProductAllowsWithdrawal() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor subscribes
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Owner freezes then unfreezes
        vm.startPrank(owner);
        ledger.freezeProduct(productId, true);
        ledger.freezeProduct(productId, false);
        vm.stopPrank();
        
        // Issuer can withdraw now
        vm.prank(issuer);
        ledger.withdrawSubscriptionFunds(productId, 50_000_000);
        
        assertEq(usdc.balanceOf(issuer), 50_000_000);
    }

    /// @notice Test issuer can withdraw subscription funds
    function testWithdrawSubscriptionFunds() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor subscribes
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        uint256 issuerBalanceBefore = usdc.balanceOf(issuer);
        uint256 withdrawAmount = 50_000_000; // 50 USDC
        
        // Issuer withdraws funds
        vm.prank(issuer);
        vm.expectEmit(true, true, false, true);
        emit SubscriptionFundsWithdrawn(productId, issuer, withdrawAmount);
        ledger.withdrawSubscriptionFunds(productId, withdrawAmount);
        
        // Verify withdrawal
        assertEq(usdc.balanceOf(issuer), issuerBalanceBefore + withdrawAmount);
        assertEq(ledger.treasuryBalanceE6(), 50_000_000);
    }

    /// @notice Test only issuer can withdraw subscription funds
    function testWithdrawSubscriptionFundsOnlyIssuer() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Non-issuer tries to withdraw
        vm.prank(investor1);
        vm.expectRevert("not issuer");
        ledger.withdrawSubscriptionFunds(productId, 50_000_000);
    }

    /// @notice Test withdrawal fails with insufficient balance
    function testWithdrawSubscriptionFundsInsufficientBalance() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Try to withdraw more than available
        vm.prank(issuer);
        vm.expectRevert("insufficient balance");
        ledger.withdrawSubscriptionFunds(productId, 200_000_000);
    }

    /// @notice Test withdrawal with zero amount fails
    function testWithdrawSubscriptionFundsZeroAmount() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.prank(issuer);
        vm.expectRevert("amount=0");
        ledger.withdrawSubscriptionFunds(productId, 0);
    }

    /// @notice Test issuer can refund investor
    function testRefund() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor subscribes with 100 USDC -> 10 units
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        uint256 investor1BalanceBefore = usdc.balanceOf(investor1);
        uint256 refundUnits = 5;
        uint256 expectedRefund = refundUnits * PRICE_PER_UNIT; // 50 USDC
        
        // Issuer refunds 5 units
        vm.prank(issuer);
        vm.expectEmit(true, true, false, true);
        emit Refunded(productId, investor1, refundUnits, expectedRefund);
        ledger.refund(productId, investor1, refundUnits);
        
        // Verify refund
        assertEq(ledger.holdingOf(productId, investor1), 5); // 10 - 5 = 5 units remaining
        assertEq(ledger.totalUnits(productId), 5);
        assertEq(usdc.balanceOf(investor1), investor1BalanceBefore + expectedRefund);
        assertEq(ledger.treasuryBalanceE6(), 50_000_000); // 100 - 50 = 50 USDC remaining
    }

    /// @notice Test only issuer can refund
    function testRefundOnlyIssuer() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Non-issuer tries to refund
        vm.prank(investor2);
        vm.expectRevert("not issuer");
        ledger.refund(productId, investor1, 5);
    }

    /// @notice Test refund fails with insufficient units
    function testRefundInsufficientUnits() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000); // 10 units
        vm.stopPrank();
        
        // Try to refund more units than investor has
        vm.prank(issuer);
        vm.expectRevert("insufficient units");
        ledger.refund(productId, investor1, 15);
    }

    /// @notice Test refund fails with insufficient contract balance
    function testRefundInsufficientBalance() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Issuer withdraws all funds
        vm.prank(issuer);
        ledger.withdrawSubscriptionFunds(productId, 100_000_000);
        
        // Try to refund when no balance left
        vm.prank(issuer);
        vm.expectRevert("insufficient balance");
        ledger.refund(productId, investor1, 5);
    }

    /// @notice Test refund with zero units fails
    function testRefundZeroUnits() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        vm.prank(issuer);
        vm.expectRevert("units=0");
        ledger.refund(productId, investor1, 0);
    }

    /// @notice Test full refund scenario
    function testFullRefund() public {
        vm.prank(owner);
        uint256 productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Investor subscribes with 100 USDC -> 10 units
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        uint256 investor1BalanceBefore = usdc.balanceOf(investor1);
        
        // Issuer refunds all 10 units
        vm.prank(issuer);
        ledger.refund(productId, investor1, 10);
        
        // Verify complete refund
        assertEq(ledger.holdingOf(productId, investor1), 0);
        assertEq(ledger.totalUnits(productId), 0);
        assertEq(usdc.balanceOf(investor1), investor1BalanceBefore + 100_000_000);
        assertEq(ledger.treasuryBalanceE6(), 0);
    }
}
