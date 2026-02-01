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
