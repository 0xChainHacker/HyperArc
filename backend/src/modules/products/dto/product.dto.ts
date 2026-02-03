export class CreateProductDto {
  name: string;
  description: string;
  issuerAddress: string;
  priceE6: string; // USDC amount with 6 decimals
  metadataURI?: string;
}

export class SubscribeDto {
  userId: string;
  productId: number;
  amountE6: string; // USDC amount with 6 decimals
}

export class DeclareDividendDto {
  productId: number;
  amountE6: string;
  issuerAddress: string;
}

export class ClaimDividendDto {
  userId: string;
  productId: number;
}

export class RefundDto {
  issuerUserId: string;  // Issuer who authorizes the refund
  productId: number;
  investorAddress: string;  // Investor to refund
  units: string;  // Number of units to refund
}

export class WithdrawFundsDto {
  issuerUserId: string;  // Issuer withdrawing the funds
  productId: number;
  amountE6: string;  // USDC amount to withdraw (6 decimals)
}
