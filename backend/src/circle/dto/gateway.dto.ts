export class CreatePaymentIntentDto {
  idempotencyKey: string;
  amount: {
    amount: string;
    currency: 'USD';
  };
  settlementCurrency: 'USD';
  paymentMethods: Array<{
    type: 'blockchain';
    chain: string;
  }>;
  metadata?: Record<string, any>;
}

export class GetPaymentDto {
  id: string;
}
