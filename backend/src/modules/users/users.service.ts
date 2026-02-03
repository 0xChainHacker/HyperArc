import { Injectable, Logger, NotFoundException, OnModuleInit, BadRequestException } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';
import * as fs from 'fs';
import * as path from 'path';

export enum WalletRole {
  ISSUER = 'issuer',      // SPV issuer wallet (create products, declare dividends)
  INVESTOR = 'investor',   // Investor wallet (subscribe to products, claim dividends)
  ADMIN = 'admin',        // Platform admin wallet
}

export interface UserWallet {
  userId: string;
  walletId: string;
  role: WalletRole;                           // Wallet role
  blockchain: string;                         // Blockchain network
  address: string;                            // Wallet address
  state: 'LIVE' | 'FROZEN';                  // Wallet state
  createdAt: string;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  // Use composite key: userId-role as Map key
  private readonly userWallets = new Map<string, UserWallet>();
  private readonly storageFile = path.join(process.cwd(), 'data', 'user-wallets.json');

  constructor(private readonly circleWalletService: CircleWalletService) {}

  onModuleInit() {
    this.loadWalletsFromFile();
  }

  /**
   * Generate composite key for Map
   */
  private getMapKey(userId: string, role: WalletRole): string {
    return `${userId}:${role}`;
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
          const key = this.getMapKey(wallet.userId, wallet.role);
          this.userWallets.set(key, wallet);
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
   * Get or create wallet for user with specific role (lazy loading)
   * This is the main method: automatically creates wallet when first needed
   * 
   * @param userId - User ID
   * @param role - Wallet role (issuer/investor/admin)
   * @param blockchain - Blockchain network (default: ARC-TESTNET)
   */
  async getOrCreateWallet(
    userId: string, 
    role: WalletRole = WalletRole.INVESTOR,
    blockchain: string = 'ARC-TESTNET'
  ): Promise<UserWallet> {
    const key = this.getMapKey(userId, role);
    
    // Check if user already has a wallet with this role
    let userWallet = this.userWallets.get(key);
    
    if (userWallet) {
      this.logger.log(`Found existing ${role} wallet for user ${userId}`);
      return userWallet;
    }

    // Create new wallet
    this.logger.log(`Creating new ${role} wallet for user ${userId} on ${blockchain}`);
    const wallet = await this.circleWalletService.createWallet(
      `${userId}-${role}`,  // Wallet name includes role
      [blockchain]
    );
    
    userWallet = {
      userId,
      walletId: wallet.id,
      role,
      blockchain,
      address: wallet.address || '',
      state: wallet.state,
      createdAt: new Date().toISOString(),
    };

    this.userWallets.set(key, userWallet);
    this.saveWalletsToFile();
    
    this.logger.log(
      `${role} wallet created successfully for user ${userId}. ` +
      `WalletId: ${wallet.id}, Address: ${wallet.address}`
    );
    
    return userWallet;
  }

  /**
   * Get user wallet by role (will not auto-create, must be created manually)
   * Throws exception if not found
   * 
   * @param userId - User ID
   * @param role - Wallet role
   */
  async getUserWallet(userId: string, role: WalletRole): Promise<UserWallet> {
    const key = this.getMapKey(userId, role);
    const userWallet = this.userWallets.get(key);
    
    if (!userWallet) {
      throw new NotFoundException(
        `${role} wallet not found for user ${userId}. ` +
        `Please create a wallet first by calling POST /wallets/${userId}?role=${role}`
      );
    }
    
    return userWallet;
  }

  /**
   * Get all wallets for a user
   */
  async getUserWallets(userId: string): Promise<UserWallet[]> {
    const wallets: UserWallet[] = [];
    
    for (const wallet of this.userWallets.values()) {
      if (wallet.userId === userId) {
        wallets.push(wallet);
      }
    }
    
    return wallets;
  }

  /**
   * Find user by wallet address (reverse query: address -> user)
   * Used to verify transaction initiator
   */
  async findUserByAddress(address: string): Promise<UserWallet | null> {
    const normalizedAddress = address.toLowerCase();
    
    for (const wallet of this.userWallets.values()) {
      if (wallet.address.toLowerCase() === normalizedAddress) {
        return wallet;
      }
    }
    
    return null;
  }

  /**
   * Get wallet by ID
   */
  async getWalletById(walletId: string): Promise<UserWallet | null> {
    for (const wallet of this.userWallets.values()) {
      if (wallet.walletId === walletId) {
        return wallet;
      }
    }
    return null;
  }

  /**
   * Verify user has specific role wallet (permission verification)
   */
  async verifyUserHasRole(userId: string, role: WalletRole): Promise<boolean> {
    const key = this.getMapKey(userId, role);
    const wallet = this.userWallets.get(key);
    return wallet !== null && wallet.state === 'LIVE';
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId: string, role: WalletRole = WalletRole.INVESTOR) {
    const userWallet = await this.getUserWallet(userId, role);
    const balance = await this.circleWalletService.getWalletBalance(userWallet.walletId);
    return balance;
  }
}
