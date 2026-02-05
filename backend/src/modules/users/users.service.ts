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
  circleWallet: { [blockchain: string]: string }; // Circle wallet addresses on each blockchain
  externalWallets?: string[];                 // External wallet addresses (array of strings)
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
      circleWallet: walletData.addresses,
      externalWallets: [],
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
   * @param includeBalance - Whether to include balance information (default: false)
   */
  async getUserWallet(userId: string, role: WalletRole, includeBalance: boolean = false): Promise<UserWallet | any> {
    const key = this.getMapKey(userId, role);
    const userWallet = this.userWallets.get(key);
    
    if (!userWallet) {
      throw new NotFoundException(
        `${role} wallet not found for user ${userId}. ` +
        `Please create a wallet first by calling POST /wallets/${userId}?role=${role}`
      );
    }
    
    if (!includeBalance) {
      return userWallet;
    }
    
    // Include balance information
    try {
      const balance = await this.getWalletBalance(userId, role);
      return {
        ...userWallet,
        balance: balance.balance,
        balanceUSD: balance.balanceUSD,
      };
    } catch (err) {
      this.logger.warn(`Failed to get balance for ${userId}:${role}:`, err.message);
      return userWallet;
    }
  }

  /**
   * Get all wallets for a user
   * @param includeBalance - Whether to include balance information for each wallet (default: false)
   */
  async getUserWallets(userId: string, includeBalance: boolean = false): Promise<UserWallet[] | any[]> {
    const wallets: UserWallet[] = [];
    
    for (const wallet of this.userWallets.values()) {
      if (wallet.userId === userId) {
        wallets.push(wallet);
      }
    }
    
    if (!includeBalance) {
      return wallets;
    }
    
    // Include balance information for each wallet
    const walletsWithBalance = await Promise.all(
      wallets.map(async (wallet) => {
        try {
          const balance = await this.getWalletBalance(userId, wallet.role);
          return {
            ...wallet,
            balance: balance.balance,
            balanceUSD: balance.balanceUSD,
          };
        } catch (err) {
          this.logger.warn(`Failed to get balance for ${userId}:${wallet.role}:`, err.message);
          return wallet;
        }
      })
    );
    
    return walletsWithBalance;
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
   * Add new blockchain to existing wallet using Circle's deriveWallet API
   * Keeps the same wallet ID and derives addresses for new blockchains
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

    // Get existing blockchains from circleWallet keys
    const existingBlockchains = Object.keys(existingWallet.circleWallet || {});

    // Filter out blockchains that already exist
    const actuallyNewBlockchains = newBlockchains.filter(
      bc => !existingBlockchains.includes(bc)
    );
    
    if (actuallyNewBlockchains.length === 0) {
      this.logger.log(`Blockchains ${newBlockchains.join(', ')} already exist for user ${userId} ${role} wallet`);
      return existingWallet;
    }

    this.logger.log(
      `Deriving wallet ${existingWallet.walletId} on new blockchains: ${actuallyNewBlockchains.join(', ')}`
    );
    
    // Derive wallet on each new blockchain using Circle SDK
    const updatedCircleWallet = { ...(existingWallet.circleWallet || {}) };
    
    for (const blockchain of actuallyNewBlockchains) {
      try {
        const walletName = `${userId}-${role}`;
        const address = await this.circleWalletService.deriveWallet(
          existingWallet.walletId,
          blockchain,
          walletName
        );
        updatedCircleWallet[blockchain] = address;
        this.logger.log(`Derived ${blockchain}: ${address}`);
      } catch (error) {
        this.logger.error(`Failed to derive wallet on ${blockchain}:`, error.message);
        throw new BadRequestException(
          `Failed to add blockchain ${blockchain}: ${error.message}`
        );
      }
    }
    
    // Update wallet (keep same wallet ID)
    const updatedWallet: UserWallet = {
      ...existingWallet,
      circleWallet: updatedCircleWallet,
    };
    
    this.userWallets.set(key, updatedWallet);
    this.saveWalletsToFile();
    
    this.logger.log(
      `Blockchains added successfully. WalletId: ${existingWallet.walletId} (unchanged), ` +
      `New blockchains: ${actuallyNewBlockchains.join(', ')}, ` +
      `Addresses: ${JSON.stringify(updatedCircleWallet)}`
    );
    
    return updatedWallet;
  }

  /**
   * Get address for specific blockchain
   */
  getAddressForBlockchain(wallet: UserWallet, blockchain: string): string | undefined {
    return wallet.circleWallet?.[blockchain];
  }

  /**
   * Link external wallet to user account
   */
  async linkExternalWallet(userId: string, role: WalletRole, address: string): Promise<boolean> {
    const key = this.getMapKey(userId, role);
    const userWallet = this.userWallets.get(key);
    
    if (!userWallet) {
      return false;
    }

    const normalizedAddress = address.toLowerCase();
    
    // Check if already linked to this user
    const alreadyLinked = userWallet.externalWallets?.some(
      ext => ext.toLowerCase() === normalizedAddress
    );
    if (alreadyLinked) {
      return true;
    }

    // Add external wallet
    if (!userWallet.externalWallets) {
      userWallet.externalWallets = [];
    }
    userWallet.externalWallets.push(normalizedAddress);

    // Save to file
    this.saveWalletsToFile();
    this.logger.log(`External wallet ${normalizedAddress} linked to ${userId}:${role}`);

    return true;
  }

  /**
   * Update last login time
   */
  async updateLastLogin(userId: string, role: WalletRole): Promise<void> {
    const key = this.getMapKey(userId, role);
    const userWallet = this.userWallets.get(key);
    
    if (userWallet) {
      userWallet.lastLogin = new Date().toISOString();
      this.saveWalletsToFile();
      this.logger.log(`Last login updated for ${userId}:${role}`);
    }
  }

  /**
   * Find user by external wallet address (checks both Circle and external wallets)
   */
  findUserByAddress(address: string): UserWallet | null {
    const normalizedAddress = address.toLowerCase();
    for (const wallet of this.userWallets.values()) {
      // Check Circle wallet addresses
      const circleAddresses = Object.values(wallet.circleWallet || {});
      if (circleAddresses.some(addr => addr?.toLowerCase() === normalizedAddress)) {
        return wallet;
      }
      
      // Check external wallets
      const hasAddress = wallet.externalWallets?.some(
        ext => ext?.toLowerCase() === normalizedAddress
      );
      if (hasAddress) {
        return wallet;
      }
    }
    return null;
  }

  /**
   * Get wallet balance (aggregates USDC across all chains)
   */
  async getWalletBalance(userId: string, role: WalletRole = WalletRole.INVESTOR) {
    const userWallet = await this.getUserWallet(userId, role);
    const tokenBalances = await this.circleWalletService.getWalletBalance(userWallet.walletId);
    
    this.logger.debug(`Processing tokenBalances for ${userId}:${role}:`, JSON.stringify(tokenBalances, null, 2));
    
    // Aggregate USDC balance across all chains
    let totalBalance = 0;
    if (Array.isArray(tokenBalances)) {
      for (const tokenBalance of tokenBalances) {
        this.logger.debug(`Token balance item:`, JSON.stringify(tokenBalance, null, 2));
        
        // Match USDC or USDC-TESTNET
        const symbol = tokenBalance.token?.symbol || '';
        const isUSDC = symbol === 'USDC' || symbol === 'USDC-TESTNET';
        
        if (isUSDC && tokenBalance.amount) {
          // Circle returns amount as string, already in decimal format
          const amount = Number(tokenBalance.amount);
          this.logger.debug(`Found ${symbol}: ${tokenBalance.amount} USD on ${tokenBalance.token?.blockchain}`);
          totalBalance += amount;
        }
      }
    }
    
    this.logger.log(`Total balance for ${userId}:${role}: ${totalBalance} USDC`);
    
    return {
      balance: (totalBalance * 1_000_000).toString(),  // Convert to E6 for contract compatibility
      balanceUSD: totalBalance,
    };
  }

  /**
   * Get detailed wallet balance (per-chain breakdown with all assets)
   */
  async getDetailedWalletBalance(userId: string, role: WalletRole = WalletRole.INVESTOR) {
    const userWallet = await this.getUserWallet(userId, role);
    const tokenBalances = await this.circleWalletService.getWalletBalance(userWallet.walletId);
    
    // Group by blockchain
    const balancesByChain: { [chain: string]: any[] } = {};
    let totalUSDC = 0;
    
    if (Array.isArray(tokenBalances)) {
      for (const tokenBalance of tokenBalances) {
        const blockchain = tokenBalance.token?.blockchain || 'UNKNOWN';
        const symbol = tokenBalance.token?.symbol || '';
        const amount = Number(tokenBalance.amount || 0);
        
        if (!balancesByChain[blockchain]) {
          balancesByChain[blockchain] = [];
        }
        
        balancesByChain[blockchain].push({
          token: {
            name: tokenBalance.token?.name,
            symbol: tokenBalance.token?.symbol,
            decimals: tokenBalance.token?.decimals,
            isNative: tokenBalance.token?.isNative,
            tokenAddress: tokenBalance.token?.tokenAddress,
          },
          amount: tokenBalance.amount,
          amountFormatted: amount.toFixed(tokenBalance.token?.decimals || 6),
          updateDate: tokenBalance.updateDate,
        });
        
        // Aggregate USDC for total
        const isUSDC = symbol === 'USDC' || symbol === 'USDC-TESTNET';
        if (isUSDC) {
          totalUSDC += amount;
        }
      }
    }
    
    return {
      userId,
      role,
      walletId: userWallet.walletId,
      summary: {
        totalUSDC: totalUSDC,
        totalUSDCE6: (totalUSDC * 1_000_000).toString(),
        chainsCount: Object.keys(balancesByChain).length,
        assetsCount: tokenBalances.length,
      },
      balancesByChain,
      rawTokenBalances: tokenBalances,
    };
  }
}
