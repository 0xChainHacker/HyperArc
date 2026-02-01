# HyperArc Contract Deployment Guide

## Prerequisites

1. **Install Foundry** (if not already installed):
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

2. **Set up environment variables**:
```bash
cp .env.example .env
# Edit .env with your actual values
```

Required environment variables:
- `PRIVATE_KEY`: Your deployer wallet private key (without 0x prefix)
- `ARC_RPC_URL`: Arc blockchain RPC endpoint
- `USDC_ADDRESS`: USDC token contract address on Arc

Optional variables:
- `OWNER_ADDRESS`: Address that will own the contracts (defaults to deployer)
- `EXAMPLE_ISSUER`: Address for demo product issuer
- `ARC_EXPLORER_API_KEY`: API key for contract verification

## Deployment Options

### Option 1: Basic Deployment (Recommended)

Deploy contracts without creating example products:

```bash
forge script script/Deploy.s.sol:DeployScript \
    --rpc-url arc \
    --broadcast \
    --verify \
    -vvvv
```

### Option 2: Deployment with Example Product

Deploy contracts and create a demo product:

```bash
forge script script/Deploy.s.sol:DeployWithExampleScript \
    --rpc-url arc \
    --broadcast \
    -vvvv
```

### Option 3: Dry Run (Simulation)

Test deployment without broadcasting transactions:

```bash
forge script script/Deploy.s.sol:DeployScript \
    --rpc-url arc \
    -vvvv
```

## Post-Deployment

After successful deployment, you'll receive contract addresses:
- `EconomicInterestLedger`: Main ledger contract
- `DividendDistributor`: Dividend distribution contract

### Save Deployment Information

Create a `deployments.json` file:
```json
{
  "network": "arc",
  "timestamp": "2026-02-01T00:00:00Z",
  "contracts": {
    "EconomicInterestLedger": "0x...",
    "DividendDistributor": "0x...",
    "USDC": "0x..."
  },
  "deployer": "0x...",
  "owner": "0x..."
}
```

## Usage Examples

### 1. Create a Product (Owner Only)

```bash
cast send <LEDGER_ADDRESS> \
    "createProduct(address,uint256,string)" \
    <ISSUER_ADDRESS> \
    10000000 \
    "ipfs://your-metadata-uri" \
    --rpc-url $ARC_RPC_URL \
    --private-key $PRIVATE_KEY
```

### 2. Subscribe to a Product (Any User)

```bash
# First, approve USDC
cast send <USDC_ADDRESS> \
    "approve(address,uint256)" \
    <LEDGER_ADDRESS> \
    100000000 \
    --rpc-url $ARC_RPC_URL \
    --private-key $USER_PRIVATE_KEY

# Then subscribe
cast send <LEDGER_ADDRESS> \
    "subscribe(uint256,uint256)" \
    1 \
    100000000 \
    --rpc-url $ARC_RPC_URL \
    --private-key $USER_PRIVATE_KEY
```

### 3. Declare Dividend (Issuer Only)

```bash
# First, approve USDC
cast send <USDC_ADDRESS> \
    "approve(address,uint256)" \
    <DISTRIBUTOR_ADDRESS> \
    300000000 \
    --rpc-url $ARC_RPC_URL \
    --private-key $ISSUER_PRIVATE_KEY

# Then declare dividend
cast send <DISTRIBUTOR_ADDRESS> \
    "declareDividend(uint256,uint256)" \
    1 \
    300000000 \
    --rpc-url $ARC_RPC_URL \
    --private-key $ISSUER_PRIVATE_KEY
```

### 4. Claim Dividends (Any Investor)

```bash
cast send <DISTRIBUTOR_ADDRESS> \
    "claim(uint256)" \
    1 \
    --rpc-url $ARC_RPC_URL \
    --private-key $INVESTOR_PRIVATE_KEY
```

## Query Functions

### Check Product Info
```bash
cast call <LEDGER_ADDRESS> \
    "products(uint256)" \
    1 \
    --rpc-url $ARC_RPC_URL
```

### Check Holdings
```bash
cast call <LEDGER_ADDRESS> \
    "holdingOf(uint256,address)" \
    1 \
    <INVESTOR_ADDRESS> \
    --rpc-url $ARC_RPC_URL
```

### Check Pending Dividends
```bash
cast call <DISTRIBUTOR_ADDRESS> \
    "pending(uint256,address)" \
    1 \
    <INVESTOR_ADDRESS> \
    --rpc-url $ARC_RPC_URL
```

## Verification

If automatic verification fails, manually verify contracts:

```bash
forge verify-contract \
    --chain-id <ARC_CHAIN_ID> \
    --compiler-version v0.8.20 \
    <CONTRACT_ADDRESS> \
    src/EconomicInterestLedger.sol:EconomicInterestLedger \
    --constructor-args $(cast abi-encode "constructor(address,address)" <USDC_ADDRESS> <OWNER_ADDRESS>)
```

## Troubleshooting

### Issue: "Insufficient funds for gas"
- Ensure your deployer wallet has enough native tokens for gas

### Issue: "Invalid USDC address"
- Verify USDC_ADDRESS in .env points to valid USDC contract on Arc

### Issue: "Deployment reverted"
- Run with `-vvvv` flag for detailed logs
- Check that all environment variables are set correctly

### Issue: "Verification failed"
- Wait a few blocks and try manual verification
- Ensure contract source matches deployed bytecode

## Security Notes

⚠️ **Important Security Practices:**

1. **Never commit `.env` file** - It contains sensitive private keys
2. **Use hardware wallet** for mainnet deployments when possible
3. **Test on testnet first** before mainnet deployment
4. **Verify contract source code** after deployment
5. **Transfer ownership** to a multisig after deployment if needed

## Contract Addresses

After deployment, update this section:

### Arc Mainnet
- EconomicInterestLedger: `TBD`
- DividendDistributor: `TBD`
- USDC: `TBD`

### Arc Testnet
- EconomicInterestLedger: `TBD`
- DividendDistributor: `TBD`
- USDC: `TBD`

## Support

For issues or questions:
- GitHub Issues: [Your Repo URL]
- Documentation: [Your Docs URL]
