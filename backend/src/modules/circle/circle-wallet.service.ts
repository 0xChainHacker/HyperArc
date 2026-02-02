import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initiateDeveloperControlledWalletsClient, Blockchain } from '@circle-fin/developer-controlled-wallets';
import { CircleWallet, CircleTransaction } from './circle.types';

@Injectable()
export class CircleWalletService {
  private readonly logger = new Logger(CircleWalletService.name);
  private readonly apiKey: string;
  private readonly entitySecret: string;
  private readonly circleDeveloperSdk: ReturnType<typeof initiateDeveloperControlledWalletsClient>;

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('circle.apiKey');
    this.entitySecret = this.configService.get<string>('circle.entitySecret');
    
    // Initialize Circle Developer SDK
    this.circleDeveloperSdk = initiateDeveloperControlledWalletsClient({
      apiKey: this.apiKey,
      entitySecret: this.entitySecret,
    });
  }

  /**
   * Create a wallet for a user
   */
  async createWallet(userId: string, blockchains: string[] = ['ARB-SEPOLIA']): Promise<CircleWallet> {
    this.logger.log(`Creating wallet for user: ${userId}, blockchains: ${blockchains.join(', ')}`);
    try {
      // First, create a WalletSet
      const walletSetResponse = await this.circleDeveloperSdk.createWalletSet({
        name: `User ${userId} WalletSet`,
      });
      
      this.logger.log(`WalletSet created: ${walletSetResponse.data?.walletSet?.id}`);
      
      // Create wallet in the WalletSet
      const walletResponse = await this.circleDeveloperSdk.createWallets({
        accountType: 'SCA',
        blockchains: blockchains as Blockchain[],
        count: 1,
        walletSetId: walletSetResponse.data?.walletSet?.id,
        metadata: [{ name: userId }],
      });
      
      const wallet = walletResponse.data?.wallets?.[0];
      this.logger.log(`Wallet created for user ${userId}: ${wallet?.id}`);
      
      return {
        id: wallet?.id || '',
        accountType: 'SCA',
        blockchains: wallet?.blockchain ? [wallet.blockchain] : [],
        address: wallet?.address,
        state: (wallet?.state as 'LIVE' | 'FROZEN') || 'LIVE',
        createDate: wallet?.createDate || '',
        updateDate: wallet?.updateDate || '',
      };
    } catch (error) {
      this.logger.error(`Failed to create wallet for user ${userId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get wallet by ID
   */
  async getWallet(walletId: string): Promise<CircleWallet> {
    this.logger.log(`Getting wallet: ${walletId}`);
    try {
      const response = await this.circleDeveloperSdk.getWallet({ id: walletId });
      const wallet = response.data?.wallet;
      
      return {
        id: wallet?.id || '',
        accountType: 'SCA',
        blockchains: wallet?.blockchain ? [wallet.blockchain] : [],
        address: wallet?.address,
        state: (wallet?.state as 'LIVE' | 'FROZEN') || 'LIVE',
        createDate: wallet?.createDate || '',
        updateDate: wallet?.updateDate || '',
      };
    } catch (error) {
      this.logger.error(`Failed to get wallet ${walletId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(walletId: string) {
    this.logger.log(`Getting balance for wallet: ${walletId}`);
    try {
      const response = await this.circleDeveloperSdk.getWalletTokenBalance({ id: walletId });
      return response.data?.tokenBalances || [];
    } catch (error) {
      this.logger.error(`Failed to get wallet balance for ${walletId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a transaction
   */
  async createTransaction(
    walletId: string,
    blockchain: string,
    destinationAddress: string,
    amount: string,
    tokenAddress?: string,
  ): Promise<CircleTransaction> {
    this.logger.log(`Creating transaction: ${amount} from ${walletId} to ${destinationAddress} on ${blockchain}`);
    try {
      const txParams: any = {
        amount: [amount],
        destinationAddress,
        walletId,
        blockchain: blockchain as any,
        fee: {
          type: 'level',
          config: {
            feeLevel: 'MEDIUM',
          },
        },
      };
      
      if (tokenAddress) {
        txParams.tokenId = tokenAddress;
      }
      
      const response = await this.circleDeveloperSdk.createTransaction(txParams);
      
      const tx = response.data;
      this.logger.log(`Transaction created: ${tx?.id}`);
      
      return {
        id: tx?.id || '',
        blockchain: blockchain,
        tokenAddress: tokenAddress,
        destinationAddress: destinationAddress,
        amount: amount,
        state: (tx?.state as any) || 'INITIATED',
        txHash: (tx as any)?.txHash,
        createDate: (tx as any)?.createDate || new Date().toISOString(),
        updateDate: (tx as any)?.updateDate || new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to create transaction', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get transaction status
   */
  async getTransaction(transactionId: string): Promise<CircleTransaction> {
    this.logger.log(`Getting transaction status: ${transactionId}`);
    try {
      const response = await this.circleDeveloperSdk.getTransaction({ id: transactionId });
      const tx = response.data?.transaction;
      
      return {
        id: tx?.id || '',
        blockchain: tx?.blockchain || '',
        tokenAddress: tx?.tokenId,
        destinationAddress: tx?.destinationAddress || '',
        amount: tx?.amounts?.[0] || '0',
        state: (tx?.state as any) || 'INITIATED',
        txHash: tx?.txHash,
        createDate: tx?.createDate || '',
        updateDate: tx?.updateDate || '',
      };
    } catch (error) {
      this.logger.error(`Failed to get transaction ${transactionId}`, error.response?.data || error.message);
      throw error;
    }
  }
}
