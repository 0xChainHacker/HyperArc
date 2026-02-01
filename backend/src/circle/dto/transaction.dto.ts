export class CreateTransactionDto {
  walletId: string;
  blockchain: string;
  tokenAddress?: string;
  destinationAddress: string;
  amount: string;
  fee?: {
    type: 'level' | 'custom';
    config?: {
      maxFee?: string;
      priorityFee?: string;
      gasLimit?: string;
      gasPrice?: string;
    };
  };
}

export class SignMessageDto {
  walletId: string;
  message: string;
}
