# HyperArc

**HyperArc** is a **Primary Issuance & Settlement Engine** for issuing economic interests and settling global cashflows in **USDC** on **Circle Arc Network**.

## Overview

HyperArc addresses cross-border investment settlement inefficiency by enabling:
- Primary issuance of economic interests in USDC
- On-chain settlement and dividend distribution on Arc Layer-1
- Automated cashflow management via smart contracts

This is a settlement infrastructure, not a trading platform.

---

## Core Features

- **Primary Issuance**: Direct subscription from issuers in USDC
- **On-Chain Settlement**: Arc Layer-1 with instant finality, no bank transfers or FX friction
- **Economic Interest Ledger**: Non-transferable position tracking on-chain
- **Automated Dividend Distribution**: Smart contract-based pro-rata cashflow distribution

---

## Technical Architecture

```
Frontend (Web)
  └─ Investor / Issuer UI
      ↓
Backend / API
  └─ Wallet abstraction
      ↓
Smart Contracts (Arc Layer-1)
  ├─ Economic Interest Ledger
  └─ Dividend Distributor
      ↓
Arc Layer-1 (USDC Settlement)
```

---

## Deployed Contracts

- **[EconomicInterestLedger](https://testnet.arcscan.app/address/0x857AC799F4AaD17E5AFe4DCf41561191F219Fc87)**: `0x857AC799F4AaD17E5AFe4DCf41561191F219Fc87`
- [DividendDistributor](https://testnet.arcscan.app/address/0x81e9367719f85e701527e3e406fdde35d5d1d48d): `0x81e9367719f85e701527e3e406fdde35d5d1d48d`

---

## Tech Stack

### Frontend
- **Next.js 16** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework

### Backend
- **NestJS** - Progressive Node.js framework
- **TypeScript** - Type-safe development
- **Express** - HTTP server

### Smart Contracts
- **Solidity 0.8.20** - Smart contract language
- **Foundry** - Smart contract development toolkit
- **OpenZeppelin** - Security-audited contract libraries

### Blockchain & Settlement
- **Circle Arc Network** - Layer-1 settlement infrastructure
- **USDC** - Native stablecoin for all cashflows

---

## Development Status

Active MVP development for HackMoney 2026.

---

## License

See the [LICENSE](LICENSE) file for details.

---

*Built for HackMoney 2026*
