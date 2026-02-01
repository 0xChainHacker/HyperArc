import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreateWalletDto, CreateWalletSetDto } from './dto/create-wallet.dto';
import { CreateTransactionDto, SignMessageDto } from './dto/transaction.dto';

@Injectable()
export class CircleWalletService {
  private readonly logger = new Logger(CircleWalletService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly entitySecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('CIRCLE_API_KEY');
    this.entitySecret = this.configService.get<string>('CIRCLE_ENTITY_SECRET');
    this.baseUrl = this.configService.get<string>('CIRCLE_WALLET_API_BASE_URL');
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a new wallet set
   */
  async createWalletSet(dto: CreateWalletSetDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/wallets/sets`,
          { name: dto.name },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Wallet set created: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to create wallet set', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a new wallet
   */
  async createWallet(dto: CreateWalletDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/wallets`,
          {
            idempotencyKey: dto.idempotencyKey,
            accountType: dto.accountType || 'SCA',
            blockchains: dto.blockchains || ['ETH-SEPOLIA'],
            metadata: dto.metadata || {},
          },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Wallet created: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to create wallet', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get wallet details
   */
  async getWallet(walletId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/wallets/${walletId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get wallet ${walletId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * List all wallets
   */
  async listWallets(pageSize = 10, pageBefore?: string) {
    try {
      const params: any = { pageSize };
      if (pageBefore) params.pageBefore = pageBefore;

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/wallets`,
          { 
            headers: this.getHeaders(),
            params,
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to list wallets', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(walletId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/wallets/${walletId}/balances`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get wallet balance for ${walletId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a transaction
   */
  async createTransaction(dto: CreateTransactionDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/wallets/${dto.walletId}/transactions`,
          {
            blockchain: dto.blockchain,
            tokenAddress: dto.tokenAddress,
            destinationAddress: dto.destinationAddress,
            amount: dto.amount,
            fee: dto.fee,
          },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Transaction created: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to create transaction', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get transaction status
   */
  async getTransaction(transactionId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/transactions/${transactionId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get transaction ${transactionId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Sign a message with wallet
   */
  async signMessage(dto: SignMessageDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/wallets/${dto.walletId}/sign`,
          { message: dto.message },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Message signed by wallet: ${dto.walletId}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to sign message', error.response?.data || error.message);
      throw error;
    }
  }
}
