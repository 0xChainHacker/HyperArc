export class CreateWalletDto {
  idempotencyKey: string;
  accountType?: 'SCA' | 'EOA';
  blockchains?: string[];
  metadata?: Record<string, any>;
}

export class CreateWalletSetDto {
  name: string;
}
