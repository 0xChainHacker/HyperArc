// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {DividendDistributor} from "../src/DividendDistributor.sol";
import {EconomicInterestLedger} from "../src/EconomicInterestLedger.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

/// @notice Test suite for DividendDistributor contract
/// @dev Tests dividend declaration, pending calculation, and claiming mechanisms
contract DividendDistributorTest is Test {
    DividendDistributor public distributor;
    EconomicInterestLedger public ledger;
    MockUSDC public usdc;
    
    // Test accounts
    address public owner = address(0x1);      // Ledger owner
    address public issuer = address(0x2);     // Product issuer (declares dividends)
    address public investor1 = address(0x3);  // First investor (10 units)
    address public investor2 = address(0x4);  // Second investor (20 units)
    
    uint256 constant PRICE_PER_UNIT = 10_000_000; // 10 USDC
    uint256 public productId;
    
    event DividendDeclared(uint256 indexed productId, address indexed issuer, uint256 amountE6, uint256 accDividendPerShareNew);
    event Claimed(uint256 indexed productId, address indexed investor, uint256 amountE6);

    /// @notice Set up test environment with deployed contracts and subscriptions
    /// @dev Creates a product with two investors holding 10 and 20 units respectively
    function setUp() public {
        // Deploy mock USDC
        usdc = new MockUSDC();
        
        // Deploy ledger contract
        vm.prank(owner);
        ledger = new EconomicInterestLedger(address(usdc), owner);
        
        // Deploy dividend distributor
        distributor = new DividendDistributor(address(usdc), address(ledger));
        
        // Create a product for testing
        vm.prank(owner);
        productId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://test");
        
        // Fund all parties with USDC
        usdc.mint(investor1, 1000_000_000); // 1000 USDC for subscriptions
        usdc.mint(investor2, 1000_000_000); // 1000 USDC for subscriptions
        usdc.mint(issuer, 10000_000_000);   // 10000 USDC for dividend payments
        
        // Investor1 subscribes: 100 USDC -> 10 units (33.33% ownership)
        vm.startPrank(investor1);
        usdc.approve(address(ledger), 100_000_000);
        ledger.subscribe(productId, 100_000_000);
        vm.stopPrank();
        
        // Investor2 subscribes: 200 USDC -> 20 units (66.67% ownership)
        vm.startPrank(investor2);
        usdc.approve(address(ledger), 200_000_000);
        ledger.subscribe(productId, 200_000_000);
        vm.stopPrank();
        
        // Total: 30 units distributed (investor1: 10, investor2: 20)
    }

    /// @notice Test issuer declaring dividends for a product
    /// @dev Verifies accumulator calculation and USDC transfer
    function testDeclareDividend() public {
        uint256 dividendAmount = 300_000_000; // 300 USDC total dividend
        
        // Issuer declares dividend
        vm.startPrank(issuer);
        usdc.approve(address(distributor), dividendAmount);
        
        vm.expectEmit(true, true, false, true);
        emit DividendDeclared(productId, issuer, dividendAmount, (dividendAmount * 1e18) / 30);
        
        distributor.declareDividend(productId, dividendAmount);
        vm.stopPrank();
        
        // Check accumulator: 300 USDC / 30 units = 10 USDC per unit (scaled by 1e18)
        // This means each unit holder will earn 10 USDC per unit owned
        uint256 expectedAcc = (dividendAmount * 1e18) / 30;
        assertEq(distributor.accDividendPerShare(productId), expectedAcc);
        assertEq(usdc.balanceOf(address(distributor)), dividendAmount);
    }

    function testDeclareDividendOnlyIssuer() public {
        vm.prank(investor1);
        vm.expectRevert("not issuer");
        distributor.declareDividend(productId, 100_000_000);
    }

    function testDeclareDividendZeroAmount() public {
        vm.prank(issuer);
        vm.expectRevert("amount=0");
        distributor.declareDividend(productId, 0);
    }

    function testDeclareDividendNoHolders() public {
        // Create a new product with no holders
        vm.prank(owner);
        uint256 emptyProductId = ledger.createProduct(issuer, PRICE_PER_UNIT, "ipfs://empty");
        
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 100_000_000);
        vm.expectRevert("no holders");
        distributor.declareDividend(emptyProductId, 100_000_000);
        vm.stopPrank();
    }

    /// @notice Test pending dividend calculation
    /// @dev Verifies proportional distribution based on unit ownership
    function testPendingDividends() public {
        uint256 dividendAmount = 300_000_000; // 300 USDC total
        
        // Declare dividend
        vm.startPrank(issuer);
        usdc.approve(address(distributor), dividendAmount);
        distributor.declareDividend(productId, dividendAmount);
        vm.stopPrank();
        
        // investor1 has 10 units (33.33%) -> should get 100 USDC
        // investor2 has 20 units (66.67%) -> should get 200 USDC
        assertEq(distributor.pending(productId, investor1), 100_000_000);
        assertEq(distributor.pending(productId, investor2), 200_000_000);
    }

    /// @notice Test claiming dividends
    /// @dev Verifies USDC transfer and pending reset after claim
    function testClaim() public {
        uint256 dividendAmount = 300_000_000; // 300 USDC
        
        // Declare dividend
        vm.startPrank(issuer);
        usdc.approve(address(distributor), dividendAmount);
        distributor.declareDividend(productId, dividendAmount);
        vm.stopPrank();
        
        uint256 balanceBefore = usdc.balanceOf(investor1);
        
        // Investor1 claims their dividends (100 USDC)
        vm.prank(investor1);
        vm.expectEmit(true, true, false, true);
        emit Claimed(productId, investor1, 100_000_000);
        
        uint256 claimed = distributor.claim(productId);
        
        // Verify claim amount and USDC transfer
        assertEq(claimed, 100_000_000);
        assertEq(usdc.balanceOf(investor1), balanceBefore + 100_000_000);
        assertEq(distributor.pending(productId, investor1), 0);
    }

    function testClaimNoUnits() public {
        address noUnitsInvestor = address(0x5);
        
        vm.prank(noUnitsInvestor);
        vm.expectRevert("no units");
        distributor.claim(productId);
    }

    function testClaimNothingToClaim() public {
        // No dividends declared yet
        vm.prank(investor1);
        vm.expectRevert("nothing to claim");
        distributor.claim(productId);
    }

    function testClaimTwice() public {
        uint256 dividendAmount = 300_000_000;
        
        vm.startPrank(issuer);
        usdc.approve(address(distributor), dividendAmount);
        distributor.declareDividend(productId, dividendAmount);
        vm.stopPrank();
        
        vm.prank(investor1);
        distributor.claim(productId);
        
        // Try to claim again immediately
        vm.prank(investor1);
        vm.expectRevert("nothing to claim");
        distributor.claim(productId);
    }

    function testMultipleDividendRounds() public {
        // First dividend: 300 USDC
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 600_000_000);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // investor1 claims first round
        vm.prank(investor1);
        uint256 claimed1 = distributor.claim(productId);
        assertEq(claimed1, 100_000_000);
        
        // Second dividend: 300 USDC
        vm.startPrank(issuer);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // investor1 claims second round
        vm.prank(investor1);
        uint256 claimed2 = distributor.claim(productId);
        assertEq(claimed2, 100_000_000);
        
        // investor2 claims both rounds at once
        vm.prank(investor2);
        uint256 claimed3 = distributor.claim(productId);
        assertEq(claimed3, 400_000_000); // 200 + 200
    }

    function testPendingAfterPartialClaim() public {
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 600_000_000);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // investor1 claims
        vm.prank(investor1);
        distributor.claim(productId);
        
        // Second dividend
        vm.startPrank(issuer);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // investor1 should only see new dividends
        assertEq(distributor.pending(productId, investor1), 100_000_000);
        // investor2 should see both rounds
        assertEq(distributor.pending(productId, investor2), 400_000_000);
    }

    function testSyncRewardDebt() public {
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 300_000_000);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // Manually sync investor1's debt
        distributor.syncRewardDebt(productId, investor1);
        
        // investor1 should now have no pending rewards
        assertEq(distributor.pending(productId, investor1), 0);
        
        // investor1 tries to claim
        vm.prank(investor1);
        vm.expectRevert("nothing to claim");
        distributor.claim(productId);
    }

    function testReentrancyProtection() public {
        // The claim function has nonReentrant modifier
        // This is more of a sanity check that the contract compiles with it
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 300_000_000);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        vm.prank(investor1);
        distributor.claim(productId);
        
        // Should not be able to claim twice
        vm.prank(investor1);
        vm.expectRevert("nothing to claim");
        distributor.claim(productId);
    }

    /// @notice Test complex multi-round dividend scenario
    /// @dev Tests multiple dividend declarations with partial claims
    function testComplexScenario() public {
        // Round 1: Declare 300 USDC dividend
        // investor1 pending: 100 USDC, investor2 pending: 200 USDC
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 1000_000_000);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // investor1 claims round 1 immediately
        vm.prank(investor1);
        uint256 claimed1 = distributor.claim(productId);
        assertEq(claimed1, 100_000_000);
        
        // Round 2: Another 300 USDC declared
        // investor1 pending: 100 USDC (new), investor2 pending: 400 USDC (200+200)
        vm.startPrank(issuer);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        // Verify pending amounts after round 2
        assertEq(distributor.pending(productId, investor1), 100_000_000);
        assertEq(distributor.pending(productId, investor2), 400_000_000); // Accumulated both rounds
        
        // investor2 claims all accumulated dividends
        vm.prank(investor2);
        uint256 claimed2 = distributor.claim(productId);
        assertEq(claimed2, 400_000_000);
        
        // Round 3: Declare 150 USDC
        // investor1 pending: 150 USDC (100+50), investor2 pending: 100 USDC
        vm.startPrank(issuer);
        distributor.declareDividend(productId, 150_000_000);
        vm.stopPrank();
        
        // Verify final pending amounts
        assertEq(distributor.pending(productId, investor1), 150_000_000); // 100 from round2 + 50 from round3
        assertEq(distributor.pending(productId, investor2), 100_000_000); // 100 from round3 only
    }

    function testPendingWithZeroUnits() public {
        address zeroUnitsInvestor = address(0x6);
        
        vm.startPrank(issuer);
        usdc.approve(address(distributor), 300_000_000);
        distributor.declareDividend(productId, 300_000_000);
        vm.stopPrank();
        
        assertEq(distributor.pending(productId, zeroUnitsInvestor), 0);
    }
}
