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
  email?: string;
  walletId: string;
  role: WalletRole;                           // Wallet role
  blockchains?: string[];                     // Supported blockchain networks
  circleWallet: { [blockchain: string]: string }; // Circle wallet addresses on each blockchain
  externalWallets?: string[];                 // External wallet addresses (array of strings)
  addresses?: { [blockchain: string]: string }; // Legacy: Addresses on each blockchain
  state: 'LIVE' | 'FROZEN';                  // Wallet state
  createdAt: string;
  lastLogin?: string;
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
   * @param blockchains - Blockchain networks (default: ARC-TESTNET)
   */
  async getOrCreateWallet(
    userId: string, 
    role: WalletRole = WalletRole.INVESTOR,
    blockchains: string[] = ['ARC-TESTNET']
  ): Promise<UserWallet> {
    const key = this.getMapKey(userId, role);
    
    // Check if user already has a wallet with this role
    let userWallet = this.userWallets.get(key);
    
    if (userWallet) {
      this.logger.log(`Found existing ${role} wallet for user ${userId}`);
      return userWallet;
    }

    // Create new wallet
    this.logger.log(`Creating new ${role} wallet for user ${userId} on ${blockchains.join(', ')}`);
    const walletData = await this.circleWalletService.createWalletWithAddresses(
      `${userId}-${role}`,  // Wallet name includes role
      blockchains
    );
    
    userWallet = {
      userId,
      walletId: walletData.id,
      role,
      blockchains: walletData.blockchains,
      circleWallet: walletData.addresses,  // Use circleWallet for new format
      addresses: walletData.addresses,      // Keep legacy field for compatibility
      externalWallets: [],                  // Initialize empty external wallets array
      state: walletData.state,
      createdAt: new Date().toISOString(),
    };

    this.userWallets.set(key, userWallet);
    this.saveWalletsToFile();
    
    this.logger.log(
      `${role} wallet created successfully for user ${userId}. ` +
      `WalletId: ${walletData.id}, Chains: ${blockchains.join(', ')}, Addresses: ${JSON.stringify(walletData.addresses)}`
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
      // Check Circle wallet addresses
      const circleAddresses = Object.values(wallet.circleWallet || wallet.addresses || {});
      if (circleAddresses.some(addr => addr.toLowerCase() === normalizedAddress)) {
        return wallet;
      }
      
      // Check external wallets
      if (wallet.externalWallets?.some(addr => addr.toLowerCase() === normalizedAddress)) {
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
   * Add new blockchain to existing wallet
   * This creates a new Circle wallet with all blockchains (existing + new)
   * 
   * @param userId - User ID
   * @param role - Wallet role
   * @param newBlockchains - New blockchains to add
   */
  async addBlockchainToWallet(
    userId: string,
    role: WalletRole,
    newBlockchains: string[]
  ): Promise<UserWallet> {
    const key = this.getMapKey(userId, role);
    const existingWallet = this.userWallets.get(key);
    
    if (!existingWallet) {
      throw new NotFoundException(`No ${role} wallet found for user ${userId}`);
    }

    // Merge existing and new blockchains
    const allBlockchains = Array.from(new Set([...existingWallet.blockchains, ...newBlockchains]));
    
    if (allBlockchains.length === existingWallet.blockchains.length) {
      this.logger.log(`Blockchains ${newBlockchains.join(', ')} already exist for user ${userId} ${role} wallet`);
      return existingWallet;
    }

    // Create new Circle wallet with all blockchains
    this.logger.log(
      `Adding blockchains ${newBlockchains.join(', ')} to user ${userId} ${role} wallet. ` +
      `Total blockchains: ${allBlockchains.join(', ')}`
    );
    
    const walletData = await this.circleWalletService.createWalletWithAddresses(
      `${userId}-${role}`,
      allBlockchains
    );
    
    // Update wallet with new data
    const updatedWallet: UserWallet = {
      ...existingWallet,
      walletId: walletData.id,  // New wallet ID
      blockchains: walletData.blockchains,
      addresses: walletData.addresses,
      state: walletData.state,
    };
    
    this.userWallets.set(key, updatedWallet);
    this.saveWalletsToFile();
    
    this.logger.log(
      `Blockchains added successfully. New WalletId: ${walletData.id}, ` +
      `Addresses: ${JSON.stringify(walletData.addresses)}`
    );
    
    return updatedWallet;
  }

  /**
   * Get address for specific blockchain
   */
  getAddressForBlockchain(wallet: UserWallet, blockchain: string): string | undefined {
    // Try circleWallet first (new format), then addresses (legacy format)
    return wallet.circleWallet?.[blockchain] || wallet.addresses?.[blockchain];
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
