import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CircleWallet, CircleTransaction } from './circle.types';

@Injectable()
export class CircleWalletService {
  private readonly logger = new Logger(CircleWalletService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('circle.apiKey');
    this.baseUrl = this.configService.get<string>('circle.walletApiBaseUrl');
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a wallet for a user
   */
  async createWallet(userId: string, blockchains: string[] = ['ARB-SEPOLIA']): Promise<CircleWallet> {
    this.logger.log(`Creating wallet for user: ${userId}, blockchains: ${blockchains.join(', ')}`);
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/wallets`,
          {
            idempotencyKey: `user-${userId}-${Date.now()}`,
            accountType: 'SCA',
            blockchains,
            metadata: { userId },
          },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Wallet created for user ${userId}: ${response.data.data.id}`);
      return response.data.data;
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
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/wallets/${walletId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data.data;
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
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/wallets/${walletId}/balances`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data.data;
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
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/wallets/${walletId}/transactions`,
          {
            blockchain,
            tokenAddress,
            destinationAddress,
            amount,
          },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Transaction created: ${response.data.data.id}`);
      return response.data.data;
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
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/transactions/${transactionId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data.data;
    } catch (error) {
      this.logger.error(`Failed to get transaction ${transactionId}`, error.response?.data || error.message);
      throw error;
    }
  }
}
