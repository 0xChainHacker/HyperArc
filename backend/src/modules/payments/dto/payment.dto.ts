export class FundArcDto {
  userId: string;
  sourceChain: string; // e.g., 'ETH', 'MATIC'
  amount: string; // USDC amount
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
