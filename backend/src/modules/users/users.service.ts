import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';
import * as fs from 'fs';
import * as path from 'path';

export interface UserWallet {
  userId: string;
  walletId: string;
  addresses: Record<string, string>; // blockchain -> address
  createdAt: string;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  private readonly userWallets = new Map<string, UserWallet>();
  private readonly storageFile = path.join(process.cwd(), 'data', 'user-wallets.json');

  constructor(private readonly circleWalletService: CircleWalletService) {}

  onModuleInit() {
    this.loadWalletsFromFile();
  }

  /**
   * Load user wallets from JSON file
   */
  private loadWalletsFromFile() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const data = fs.readFileSync(this.storageFile, 'utf-8');
        const wallets: UserWallet[] = JSON.parse(data);
        wallets.forEach(wallet => {
          this.userWallets.set(wallet.userId, wallet);
        });
        this.logger.log(`Loaded ${wallets.length} wallets from storage`);
      } else {
        this.logger.log('No existing wallet storage found, starting fresh');
      }
    } catch (error) {
      this.logger.error('Failed to load wallets from file', error.message);
    }
  }

  /**
   * Save user wallets to JSON file
   */
  private saveWalletsToFile() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const wallets = Array.from(this.userWallets.values());
      fs.writeFileSync(this.storageFile, JSON.stringify(wallets, null, 2), 'utf-8');
      this.logger.log(`Saved ${wallets.length} wallets to storage`);
    } catch (error) {
      this.logger.error('Failed to save wallets to file', error.message);
    }
  }

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
      createdAt: new Date().toISOString(),
    };

    this.userWallets.set(userId, userWallet);
    this.saveWalletsToFile();
    
    this.logger.log(`Wallet created successfully for user ${userId}, walletId: ${wallet.id}`);
    return userWallet;
  }

  /**
   * Get user wallet info
   */
  async getUserWallet(userId: string) {
    const userWallet = this.userWallets.get(userId);
    if (!userWallet) {
      throw new NotFoundException(
        `Wallet not found for user ${userId}. Please create a wallet first by calling POST /wallets/${userId}`
      );
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
