export class FundArcDto {
  userId: string;
  sourceChain: string; // e.g., 'ETH', 'MATIC'
  amount: string; // USDC amount
}

export class DepositToGatewayDto {
  userId: string;
  sourceChain: 'ETH-SEPOLIA' | 'BASE-SEPOLIA' | 'AVAX-FUJI';
  amount: number; // USDC amount (e.g., 10 for 10 USDC)
}

export class TransferToArcDto {
  userId: string;
  sourceChain: 'ETH-SEPOLIA' | 'BASE-SEPOLIA' | 'AVAX-FUJI';
  amount: number;
  maxFee?: string;
}

export class SubscribeDto {
  userId: string;
  productId: number;
  amountE6: string;
}

export class DeclareDividendDto {
  issuerUserId: string;  // Issuer user ID
  productId: number;
  amountE6: string;  // Dividend amount in USDC (6 decimals)
}

export class ClaimDividendDto {
  userId: string;  // Investor user ID
  productId: number;
}

