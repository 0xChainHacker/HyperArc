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
