# HyperArc Backend API Documentation

## API Endpoints

### 1. Wallet Management

#### Create or Get Wallet (with Role)
```http
POST /wallets/:userId?role=investor
POST /wallets/:userId?role=issuer
```
Creates or retrieves a Circle wallet for a user with specific role.

**Query Parameters:**
- `role` (optional): `investor` (default), `issuer`, or `admin`

**Example - Create Investor Wallet:**
```http
POST /wallets/user-123?role=investor
```

**Example - Create Issuer Wallet:**
```http
POST /wallets/spv-001?role=issuer
```

**Response:**
```json
{
  "userId": "user-123",
  "walletId": "wallet-abc-123",
  "role": "investor",
  "blockchain": "ARB-SEPOLIA",
  "address": "0x1234...",
  "state": "LIVE",
  "createdAt": "2026-02-02T..."
}
```

#### Add Blockchains to Existing Wallet
```http
POST /wallets/:userId/blockchains?role=investor&blockchains=ARB-SEPOLIA,MATIC-AMOY
```

**Description**: Extends an existing wallet to support additional blockchains using Circle's `deriveWallet` API.

**Query Parameters:**
- `role` (optional): `investor` (default), `issuer`, or `admin`
- `blockchains` (required): Comma-separated list of new blockchains to add

**How it works:**
- Uses Circle's `deriveWallet` API to derive addresses on new blockchains
- **Wallet ID remains unchanged** (same Circle wallet)
- Derives new blockchain addresses from the same private key
- Each blockchain gets registered in Circle's system
- EOA wallets will have the same address across all chains

**Example Request:**
```http
POST /wallets/user123/blockchains?role=investor&blockchains=ARB-SEPOLIA,MATIC-AMOY
```

**Example Response:**
```json
{
  "userId": "user123",
  "walletId": "d3eacc15-1ec1-582e-a13c-b9dea0e9a727",
  "role": "investor",
  "blockchains": [
    "ARC-TESTNET",
    "ARB-SEPOLIA",
    "MATIC-AMOY"
  ],
  "circleWallet": {
    "ARC-TESTNET": "0x7027ad4a67b60fc91908ba9b01205075219a81b6",
    "ARB-SEPOLIA": "0x7027ad4a67b60fc91908ba9b01205075219a81b6",
    "MATIC-AMOY": "0x7027ad4a67b60fc91908ba9b01205075219a81b6"
  },
  "state": "LIVE"
}
```

**Benefits:**
- Preserves wallet ID and continuity
- Properly registers new blockchains in Circle's system
- Maintains same address across all chains (EOA)
- Enables cross-chain operations seamlessly

---

#### Get Wallet Info
```http
GET /wallets/:userId?role=investor
```

**Query Parameters:**
- `role` (optional): If provided, returns wallet for specific role. If omitted, returns all wallets for the user.

**Example - Get Specific Role:**
```http
GET /wallets/user-123?role=issuer
```

**Response (single wallet):**
```json
{
  "userId": "user-123",
  "walletId": "wallet-xyz",
  "role": "issuer",
  "blockchain": "ARB-SEPOLIA",
  "address": "0xabcd...",
  "state": "LIVE",
  "createdAt": "2026-02-02T..."
}
```

**Example - Get All Wallets:**
```http
GET /wallets/user-123
```

**Response (array):**
```json
[
  {
    "userId": "user-123",
    "walletId": "wallet-abc",
    "role": "investor",
    "address": "0x1234..."
  },
  {
    "userId": "user-123",
    "walletId": "wallet-xyz",
    "role": "issuer",
    "address": "0xabcd..."
  }
]
```

#### Get Wallet Balance (All Assets, Multi-Chain)
```http
GET /wallets/:userId/balance?role=investor
```

**Description**: Get detailed balance breakdown by blockchain, including all assets (via Circle Wallet API).

✅ **Recommended for Testnet**: This API returns all tokens including native testnet tokens like `USDC-TESTNET` (18 decimals).

**Query Parameters:**
- `role` (optional): `investor` (default), `issuer`, or `admin`

**Response:**
```json
{
  "userId": "user-123",
  "role": "investor",
  "walletIds": ["d3eacc15-1ec1-582e-a13c-b9dea0e9a727"],
  "summary": {
    "totalUSDC": 16.986759,
    "totalUSDCE6": "16986759",
    "chainsCount": 4,
    "assetsCount": 5
  },
  "balancesByChain": {
    "ARC-TESTNET": [
      {
        "token": {
          "name": "USDC-TESTNET",
          "symbol": "USDC-TESTNET",
          "decimals": 18,
          "isNative": true,
          "tokenAddress": null
        },
        "amount": "16.986759015867865464",
        "amountFormatted": "16.986759",
        "updateDate": "2026-02-03T16:43:03Z"
      }
    ],
    "ARB-SEPOLIA": [...],
    "MATIC-AMOY": [...],
    "ETH-SEPOLIA": [...]
  }
}
```

**Use Case**: 
- Display per-chain asset breakdown
- Show non-USDC assets (EURC, native tokens, etc.)
- Portfolio analytics and multi-asset management

---

#### Get Unified USDC Balance (Cross-Chain)
```http
GET /wallets/:userId/balance/usdc?role=investor&chains=ARC-TESTNET,ETH-SEPOLIA
```

**Description**: Get unified USDC balance across multiple chains using Circle Gateway API.

⚠️ **IMPORTANT - Testnet Limitation**: 
- Gateway API only supports **standard USDC (6 decimals)** via Circle's CCTP
- **Does NOT include testnet native tokens** like `USDC-TESTNET` (18 decimals, isNative: true)
- For testnet balances, use `GET /wallets/:userId/balance` instead
- This API is primarily for production mainnet USDC cross-chain queries

**Query Parameters:**
- `role` (optional): `investor` (default), `issuer`, or `admin`
- `chains` (optional): Comma-separated list of chains (defaults to all supported chains)

**Supported Chains:**
- `ARC-TESTNET` (domain 26)
- `ETH-SEPOLIA` (domain 0)
- `BASE-SEPOLIA` (domain 6)
- `AVAX-FUJI` (domain 1)

**Response:**
```json
{
  "userId": "user-123",
  "role": "investor",
  "walletId": "...",
  "depositorAddress": "0x...",
  "totalBalanceE6": "50000000",
  "totalBalanceUSDC": "50.000000",
  "balancesByChain": [
    {
      "chain": "ARC-TESTNET",
      "domain": 26,
      "balanceE6": "20000000",
      "balanceUSDC": "20.000000"
    },
    {
      "chain": "ETH-SEPOLIA",
      "domain": 0,
      "balanceE6": "30000000",
      "balanceUSDC": "30.000000"
    }
  ]
}
```

**Use Case**: 
- **Mainnet**: Cross-chain USDC balance aggregation
- **Testnet**: Will show 0 for native tokens (use detailed balance API instead)
- Gateway transfer preparation (mainnet only)

---

#### Get ARC USDC Balance & Allowance
```http
GET /wallets/:userId/balance/arc?role=investor
```

**Description**: Get USDC balance and allowance on ARC-TESTNET chain (via blockchain query).

**Query Parameters:**
- `role` (optional): `investor` (default), `issuer`, or `admin`

**Response:**
```json
{
  "userId": "user-123",
  "role": "investor",
  "walletId": "...",
  "chain": "ARC-TESTNET",
  "address": "0x...",
  "balance": {
    "balanceE6": "100000000",
    "balanceUSDC": "100.000000"
  },
  "allowance": {
    "allowanceE6": "50000000",
    "allowanceUSDC": "50.000000"
  }
}
```

**Use Case**: 
- Investment subscription pages
- Check USDC balance before subscribing
- Verify allowance for Ledger contract
- Arc-specific operations

---

### 2. Cross-chain Funding (Circle Gateway)

Circle Gateway provides a two-step process for cross-chain USDC transfers:

**Step 1: Deposit** - Move USDC from source chain to Gateway Wallet (unified balance)
**Step 2: Transfer** - Move USDC from Gateway unified balance to destination chain (ARC-TESTNET)

#### Step 1: Deposit USDC to Gateway
```http
POST /gateway/deposit
```

**Description**: Deposit USDC from source chain to Circle Gateway Wallet. This is Step 1 of the cross-chain transfer process.

**Request Body:**
```json
{
  "userId": "user123",
  "sourceChain": "ETH-SEPOLIA",
  "amount": "10"
}
```

**What this endpoint does:**
1. Approves USDC for Gateway Wallet contract
2. Deposits USDC to Gateway Wallet
3. USDC becomes part of Gateway's unified balance
4. After finality, can be transferred to any destination chain

**Response:**
```json
{
  "success": true,
  "message": "Deposited 10 USDC to Gateway Wallet",
  "userId": "user123",
  "sourceChain": "ETH-SEPOLIA",
  "amount": "10",
  "approveTxId": "circle-tx-abc123",
  "depositTxId": "circle-tx-def456"
}
```

**Supported Source Chains:**
- ETH-SEPOLIA (Ethereum Sepolia)
- BASE-SEPOLIA (Base Sepolia)
- AVAX-FUJI (Avalanche Fuji)

---

#### Step 2: Transfer USDC to ARC
```http
POST /gateway/transfer-to-arc
```

**Description**: Transfer USDC from Gateway unified balance (specific source chain and amount) to ARC-TESTNET.

**Prerequisites**: Must have deposited USDC to Gateway Wallet first using `/gateway/deposit` endpoint.

**Request Body:**
```json
{
  "userId": "user123",
  "sourceChain": "ETH-SEPOLIA",
  "amount": 10,
  "maxFee": "2010000"
}
```

**What this endpoint does:**
1. Builds burn intent for specified amount
2. Signs burn intent (EIP-712)
3. Submits to Gateway API for attestation
4. Mints USDC on ARC-TESTNET via GatewayMinter

**Response:**
```json
{
  "success": true,
  "message": "Transferred 10 USDC from ETH-SEPOLIA to ARC-TESTNET",
  "userId": "user123",
  "sourceChain": "ETH-SEPOLIA",
  "destinationChain": "ARC-TESTNET",
  "amount": 10,
  "sourceAddress": "0x123...",
  "destinationAddress": "0xABC...",
  "attestation": "0x...",
  "mintTxId": "circle-tx-xyz789"
}
```

**Complete Two-Step Example:**
```bash
# Step 1: Deposit USDC from ETH-SEPOLIA to Gateway
POST /gateway/deposit
{
  "userId": "user123",
  "sourceChain": "ETH-SEPOLIA",
  "amount": 10
}
# Wait for finality (~15 minutes)

# Step 2: Transfer from Gateway to ARC-TESTNET
POST /gateway/transfer-to-arc
{
  "userId": "user123",
  "sourceChain": "ETH-SEPOLIA",
  "amount": 10,
  "maxFee": "2010000"
}
```

---

### 3. Products (Economic Interest Issuance)

#### Create Product (Issuer Only)
```http
POST /products?issuerUserId=issuer123
```

**Description**: Create a new economic interest product on-chain. This endpoint can only be called by the issuer/SPV who will own the product. The issuer's own wallet will be used to sign and pay for the transaction.

**Query Parameters:**
- `issuerUserId` (required): The user ID of the issuer/SPV. Must have a registered wallet.

**Request Body:**
```json
{
  "name": "Real Estate Fund A",
  "description": "Premium commercial real estate in NYC",
  "issuerAddress": "0x...",
  "priceE6": "10000000",
  "metadataURI": "ipfs://..."
}
```

**Response:**
```json
{
  "productId": 1,
  "name": "Real Estate Fund A",
  "issuer": "0x...",
  "active": true,
  "priceE6": "10000000"
}
```

**Authorization**: Issuer/SPV wallet only
**Gas Fee**: Paid by issuer's wallet
```

#### List Products
```http
GET /products
```

#### Get Product Details
```http
GET /products/:productId
```

**Response:**
```json
{
  "productId": 1,
  "name": "Real Estate Fund A",
  "description": "...",
  "issuer": "0x...",
  "active": true,
  "frozen": false,
  "priceE6": "10000000",
  "metadataURI": "ipfs://..."
}
```

#### Get Product Total Units
```http
GET /products/:productId/total-units
```

**Response:**
```json
{
  "productId": 1,
  "totalUnits": "1000"
}
```

#### Deactivate Product (Issuer Only)
```http
POST /products/:productId/deactivate
```

**Description**: Issuer deactivates product to prevent new investments. Must be called before refunding investors.

**Request Body:**
```json
{
  "issuerUserId": "spv-001"
}
```

**Response:**
```json
{
  "success": true,
  "productId": 1,
  "txId": "circle-tx-123",
  "txHash": "0x...",
  "message": "Product deactivated successfully. New investments are now disabled."
}
```

#### Refund Investor (Issuer Only)
```http
POST /products/:productId/refund
```

**Description**: Issuer refunds investor by burning units and returning USDC. Product must be deactivated first.

**Request Body:**
```json
{
  "issuerUserId": "spv-001",
  "investorAddress": "0x...",
  "units": "100"
}
```

**Response:**
```json
{
  "success": true,
  "productId": 1,
  "investorAddress": "0x...",
  "units": "100",
  "txId": "circle-tx-456",
  "txHash": "0x...",
  "message": "Investor refunded successfully"
}
```

#### Withdraw Subscription Funds (Issuer Only)
```http
POST /products/:productId/withdraw
```

**Description**: Issuer withdraws USDC from the contract treasury.

**Request Body:**
```json
{
  "issuerUserId": "spv-001",
  "amountE6": "1000000000"
}
```

**Response:**
```json
{
  "success": true,
  "productId": 1,
  "amountE6": "1000000000",
  "txId": "circle-tx-789",
  "txHash": "0x...",
  "message": "Subscription funds withdrawn successfully"
}
```

#### Get Treasury Balance
```http
GET /products/treasury/balance
```

**Description**: Get total USDC balance held in the contract treasury.

**Response:**
```json
{
  "balanceE6": "5000000000",
  "balanceUSDC": "5000.00"
}
```

---

### 4. Investment (Arc Contracts - Investor Only)

#### Subscribe to Product (Investor Only)
```http
POST /invest/subscribe
```

**Description**: Investor subscribes to a product by purchasing units. Uses the investor's wallet to approve USDC and call the subscription function.

**Request Body:**
```json
{
  "userId": "user123",
  "productId": 1,
  "amountE6": "50000000"
}
```

**Response:**
```json
{
  "success": true,
  "productId": 1,
  "amount": "50000000",
  "approveTxHash": "0x...",
  "subscribeTxHash": "0x..."
}
```

**Authorization**: Investor wallet only
**Gas Fee**: Paid by investor's wallet

---

### 5. Dividends (Arc Contracts)

#### Declare Dividend (Issuer Only)
```http
POST /dividends/declare
```

**Description**: Issuer declares and distributes dividends to all product holders. The system will:
1. Verify issuer owns the product
2. Check issuer has sufficient USDC balance
3. Approve USDC to distributor contract
4. Execute declareDividend transaction

**Request Body:**
```json
{
  "issuerUserId": "spv-001",
  "productId": 1,
  "amountE6": "1000000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Dividend declared successfully",
  "productId": 1,
  "amountE6": "1000000",
  "issuer": "0x...",
  "approveTxId": "circle-tx-123",
  "approveTxHash": "0x...",
  "declareTxId": "circle-tx-456",
  "declareTxHash": "0x..."
}
```

**Authorization**: Issuer/SPV wallet only (must be product owner)
**Gas Fee**: Paid by issuer's wallet

#### Claim Dividend (Investor Only)
```http
POST /dividends/claim
```

**Description**: Investor claims their pending dividends from a product. The system will:
1. Check pending dividend amount
2. Execute claim transaction on distributor contract
3. Transfer USDC to investor's wallet

**Request Body:**
```json
{
  "userId": "user123",
  "productId": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Dividend claimed successfully",
  "userId": "user123",
  "productId": 1,
  "investor": "0x...",
  "amountClaimedE6": "500000",
  "claimTxId": "circle-tx-789",
  "claimTxHash": "0x..."
}
```

**Authorization**: Investor wallet only
**Gas Fee**: Paid by investor's wallet

---

### 6. Portfolio (Read-only)

#### Get User Portfolio
```http
GET /portfolio/:userId
```

**Description**: Get user's complete investment portfolio including holdings and pending dividends.

**Response:**
```json
{
  "userId": "user123",
  "arcAddress": "0x...",
  "usdcBalance": "100000000",
  "holdings": [
    {
      "productId": 1,
      "productName": "Real Estate Fund A",
      "units": "5",
      "pendingDividend": "500000"
    }
  ],
  "totalPendingDividends": "500000"
}
```

#### Get Product Holding
```http
GET /portfolio/:userId/product/:productId
```

**Description**: Get user's holdings and pending dividends for a specific product.

**Response:**
```json
{
  "userId": "user123",
  "productId": 1,
  "units": "5",
  "pendingDividend": "500000"
}
```

**Note**: For wallet balance and allowance queries, use the Wallet Management APIs:
- `GET /wallets/:userId/balance/usdc` - Unified USDC across chains
- `GET /wallets/:userId/balance/arc` - ARC chain USDC + allowance

---

## Architecture

## 🔐 Role-Based Access Control

HyperArc uses a role-based wallet system to ensure proper authorization for different operations:

### Wallet Roles

#### 1. **Issuer/SPV Wallet** (Product Creator)
**Can Do:**
- ✅ Create products (`POST /products`)
- ✅ Declare dividends (`POST /dividends/declare`)
- ✅ Update product metadata
- ✅ View their own products and holdings

**Cannot Do:**
- ❌ Subscribe to their own products
- ❌ Claim dividends from their own products

**Wallet Creation:**
```http
POST /wallets/issuer-spv-001
```

#### 2. **Investor Wallet** (Product Purchaser)
**Can Do:**
- ✅ Subscribe to products (`POST /invest/subscribe`)
- ✅ Claim dividends (`POST /dividends/claim`)
- ✅ View portfolio (`GET /portfolio/:userId`)
- ✅ Transfer holdings

**Cannot Do:**
- ❌ Create products
- ❌ Declare dividends

**Wallet Creation:**
```http
POST /wallets/investor-user-123
```

#### 3. **Platform Admin Wallet** (Optional)
**Can Do:**
- ✅ Manage contract upgrades
- ✅ Pause/unpause system (if implemented)
- ✅ Pay gas fees on behalf of users (if subsidized)

### Authorization Flow

```
User Request → Check userId → Get Wallet → Verify Role → Execute Transaction
```

**Example: Creating a Product**
1. Issuer calls `POST /products?issuerUserId=issuer-spv-001`
2. Backend retrieves wallet for `issuer-spv-001`
3. Verifies wallet exists and has signing capability
4. Uses issuer's wallet to sign `createProduct` transaction
5. Issuer pays gas fee from their wallet

**Example: Subscribing to Product**
1. Investor calls `POST /invest/subscribe` with `userId=investor-123`
2. Backend retrieves wallet for `investor-123`
3. Uses investor's wallet to approve USDC and subscribe
4. Investor pays gas fee from their wallet

### Security Considerations

⚠️ **Important**: 
- Each user should have their own unique wallet
- Wallet IDs should not be exposed in URLs (use authentication)
- Issuer addresses must match their wallet addresses
- All transactions require signature from the appropriate wallet

### Future Enhancements

🔜 **Planned**:
- JWT-based authentication
- Role verification at contract level
- Multi-signature support for high-value operations
- Wallet recovery mechanisms

---

## Architecture

```
src/
  config/
    circle.config.ts      # Circle API configuration
    app.config.ts         # App & Arc configuration
  modules/
    circle/
      circle.module.ts
      circle-wallet.service.ts    # Circle Wallet SDK
      circle-gateway.service.ts   # Circle Gateway SDK
      circle.types.ts
    chain/
      chain.module.ts
      arc-contract.service.ts     # Arc contract interactions (完整實作)
      abi/
        EconomicInterestLedger.json  # Ledger contract ABI
        DividendDistributor.json     # Distributor contract ABI
        USDC.json                    # USDC token ABI
    users/
      users.module.ts
      users.service.ts            # User wallet management (role-based)
      users.controller.ts
    products/
      products.module.ts
      products.service.ts         # Product CRUD + 管理功能
      products.controller.ts
      dto/
        product.dto.ts            # CreateProduct, Refund, Withdraw DTOs
    payments/
      payments.module.ts
      payments.service.ts         # 串接 wallet + gateway + contracts
      payments.controller.ts
      dto/
        payment.dto.ts            # Subscribe, Dividend DTOs
    portfolio/
      portfolio.module.ts
      portfolio.service.ts        # 讀取持倉、餘額、授權額度
      portfolio.controller.ts
```

---

## Environment Variables

Update `.env` with:

```env
# Circle API
CIRCLE_API_KEY=your_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret

# Arc Network
ARC_NETWORK_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002

# Deployed Contracts
ARC_LEDGER_CONTRACT_ADDRESS=0x...
ARC_DISTRIBUTOR_CONTRACT_ADDRESS=0x...
ARC_USDC_ADDRESS=0x...
```

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run start:dev

# Build
npm run build

# Run in production
npm run start:prod
```

---

## Notes

- All amounts are in **USDC with 6 decimals** (e.g., `1000000` = 1 USDC)
- Transaction signing is handled via Circle Wallet SDK
- Contract interactions require user signatures through Circle
- Portfolio data is fetched from Arc blockchain in real-time
