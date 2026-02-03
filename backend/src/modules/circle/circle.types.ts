export interface CircleWallet {
  id: string;
  accountType: 'EOA' | 'SCA';
  blockchains: string[];
  address?: string;
  state: 'LIVE' | 'FROZEN';
  createDate: string;
  updateDate: string;
}

export interface CircleTransaction {
  id: string;
  blockchain: string;
  tokenAddress?: string;
  destinationAddress: string;
  amount: string;
  state: 'INITIATED' | 'PENDING_RISK_SCREENING' | 'QUEUED' | 'SENT' | 'CONFIRMED' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
  txHash?: string;
  createDate: string;
  updateDate: string;
}

export interface CirclePaymentIntent {
  id: string;
  amount: {
    amount: string;
    currency: string;
  };
  settlementCurrency: string;
  status: 'created' | 'pending' | 'complete' | 'failed';
  paymentMethods: Array<{
    type: string;
    chain: string;
  }>;
  createDate: string;
  updateDate: string;
}

export interface CirclePayment {
  id: string;
  amount: {
    amount: string;
    currency: string;
  };
  status: 'pending' | 'complete' | 'failed';
  blockchain?: string;
  txHash?: string;
  createDate: string;
}

export interface CreateWalletDto {
  userId: string;
  blockchains?: string[];
}

export interface FundArcDto {
  userId: string;
  sourceChain: string;
  amount: string;
}

export interface GatewayTransactionStatus {
  txId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  blockchain?: string;
  txHash?: string;
  amount?: string;
}
