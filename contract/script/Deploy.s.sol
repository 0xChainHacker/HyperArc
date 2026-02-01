// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {EconomicInterestLedger} from "../src/EconomicInterestLedger.sol";
import {DividendDistributor} from "../src/DividendDistributor.sol";

/// @notice Deployment script for HyperArc contracts on Arc blockchain
/// @dev Run with: forge script script/Deploy.s.sol:DeployScript --rpc-url arc --broadcast --verify
contract DeployScript is Script {
    // Arc USDC address (update this with actual Arc USDC address)
    // For testnet, you might need to deploy a mock USDC first
    address public USDC_ADDRESS;
    
    // Deployer will be the owner of EconomicInterestLedger
    address public owner;
    
    function setUp() public {
        // Load environment variables
        // Owner address (defaults to deployer if not set)
        owner = vm.envOr("OWNER_ADDRESS", msg.sender);
        
        // USDC address on Arc (MUST be set in .env)
        USDC_ADDRESS = vm.envAddress("USDC_ADDRESS");
        
        console2.log("=== Deployment Configuration ===");
        console2.log("Deployer:", msg.sender);
        console2.log("Owner:", owner);
        console2.log("USDC Address:", USDC_ADDRESS);
        console2.log("================================");
    }

    function run() external {
        // Start broadcasting transactions
        // Supports: --interactive, --ledger, --account, or PRIVATE_KEY env var
        vm.startBroadcast();

        // 1. Deploy EconomicInterestLedger
        console2.log("\n[1/2] Deploying EconomicInterestLedger...");
        EconomicInterestLedger ledger = new EconomicInterestLedger(
            USDC_ADDRESS,
            owner
        );
        console2.log("EconomicInterestLedger deployed at:", address(ledger));

        // 2. Deploy DividendDistributor
        console2.log("\n[2/2] Deploying DividendDistributor...");
        DividendDistributor distributor = new DividendDistributor(
            USDC_ADDRESS,
            address(ledger)
        );
        console2.log("DividendDistributor deployed at:", address(distributor));

        vm.stopBroadcast();

        // Log deployment summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("Network: Arc");
        console2.log("USDC Token:", USDC_ADDRESS);
        console2.log("EconomicInterestLedger:", address(ledger));
        console2.log("DividendDistributor:", address(distributor));
        console2.log("Owner:", owner);
        console2.log("==========================");
        
        console2.log("\n=== Next Steps ===");
        console2.log("1. Save the contract addresses above");
        console2.log("2. Create products using: createProduct(issuer, priceE6, metadataURI)");
        console2.log("3. Investors can subscribe to products");
        console2.log("4. Issuers can declare dividends via DividendDistributor");
        console2.log("==================");
    }
}

/// @notice Deployment script with example product creation
/// @dev Run with: forge script script/Deploy.s.sol:DeployWithExampleScript --rpc-url arc --broadcast
contract DeployWithExampleScript is Script {
    address public USDC_ADDRESS;
    address public owner;
    address public exampleIssuer;
    
    function setUp() public {
        owner = vm.envOr("OWNER_ADDRESS", msg.sender);
        USDC_ADDRESS = vm.envAddress("USDC_ADDRESS");
        exampleIssuer = vm.envOr("EXAMPLE_ISSUER", msg.sender);
        
        console2.log("=== Deployment Configuration ===");
        console2.log("Deployer:", msg.sender);
        console2.log("Owner:", owner);
        console2.log("USDC Address:", USDC_ADDRESS);
        console2.log("Example Issuer:", exampleIssuer);
        console2.log("================================");
    }

    function run() external {
        // Start broadcasting transactions
        // Supports: --interactive, --ledger, --account, or PRIVATE_KEY env var
        vm.startBroadcast();

        // Deploy contracts
        console2.log("\n[1/3] Deploying EconomicInterestLedger...");
        EconomicInterestLedger ledger = new EconomicInterestLedger(
            USDC_ADDRESS,
            owner
        );
        console2.log("EconomicInterestLedger deployed at:", address(ledger));

        console2.log("\n[2/3] Deploying DividendDistributor...");
        DividendDistributor distributor = new DividendDistributor(
            USDC_ADDRESS,
            address(ledger)
        );
        console2.log("DividendDistributor deployed at:", address(distributor));

        // Create example product (only if deployer is owner)
        if (msg.sender == owner) {
            console2.log("\n[3/3] Creating example product...");
            uint256 productId = ledger.createProduct(
                exampleIssuer,
                10_000_000, // 10 USDC per unit
                "ipfs://QmExample123/metadata.json"
            );
            console2.log("Example product created with ID:", productId);
        } else {
            console2.log("\n[3/3] Skipping example product (deployer is not owner)");
        }

        vm.stopBroadcast();

        // Log deployment summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("Network: Arc");
        console2.log("USDC Token:", USDC_ADDRESS);
        console2.log("EconomicInterestLedger:", address(ledger));
        console2.log("DividendDistributor:", address(distributor));
        console2.log("Owner:", owner);
        console2.log("==========================");
    }
}
