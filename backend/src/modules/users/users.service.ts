import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';

export interface UserWallet {
  userId: string;
  walletId: string;
  addresses: Record<string, string>; // blockchain -> address
  createdAt: Date;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  // In production, this would be a database
  private readonly userWallets = new Map<string, UserWallet>();

  constructor(private readonly circleWalletService: CircleWalletService) {}

  /**
   * Get or create wallet for user
   */
  async getOrCreateWallet(userId: string) {
    // Check if user already has a wallet
    let userWallet = this.userWallets.get(userId);
    
    if (userWallet) {
      this.logger.log(`Found existing wallet for user ${userId}`);
      return userWallet;
    }

    // Create new wallet
    this.logger.log(`Creating new wallet for user ${userId}`);
    const wallet = await this.circleWalletService.createWallet(userId, ['ARB-SEPOLIA']);
    
    userWallet = {
      userId,
      walletId: wallet.id,
      addresses: {
        'ARB-SEPOLIA': wallet.address || '',
      },
      createdAt: new Date(),
    };

    this.userWallets.set(userId, userWallet);
    this.logger.log(`Wallet created successfully for user ${userId}, walletId: ${wallet.id}`);
    return userWallet;
  }

  /**
   * Get user wallet info
   */
  async getUserWallet(userId: string) {
    const userWallet = this.userWallets.get(userId);
    if (!userWallet) {
      throw new NotFoundException(`Wallet not found for user ${userId}`);
    }
    return userWallet;
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId: string) {
    const userWallet = await this.getUserWallet(userId);
    const balance = await this.circleWalletService.getWalletBalance(userWallet.walletId);
    return balance;
  }
}
