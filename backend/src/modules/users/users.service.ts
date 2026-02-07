import { Injectable, Logger, NotFoundException, OnModuleInit, BadRequestException } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';
import { CircleGatewayService, WalletChain } from '../circle/circle-gateway.service';
import { ArcContractService } from '../chain/arc-contract.service';
import * as fs from 'fs';
import * as path from 'path';

export enum WalletRole {
  ISSUER = 'issuer',      // SPV issuer wallet (create products, declare dividends)
  INVESTOR = 'investor',   // Investor wallet (subscribe to products, claim dividends)
  ADMIN = 'admin',        // Platform admin wallet
}

export interface ChainWallet {
  walletId: string;
  address: string;
}

export interface UserWallet {
  userId: string;
  email?: string;
  role: WalletRole;                           // Wallet role
  circleWallet: { [blockchain: string]: ChainWallet }; // Per-chain wallet info
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

  constructor(
    private readonly circleWalletService: CircleWalletService,
    private readonly circleGatewayService: CircleGatewayService,
    private readonly arcContractService: ArcContractService,
  ) {}

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
   * Check if token symbol is USDC (supports various testnet naming)
   * Mainnet: USDC
   * Testnets: USDC-TESTNET, USDCTest, USDC.e, etc.
   */
  private isUSDCToken(symbol: string): boolean {
    const normalizedSymbol = symbol.toUpperCase();
    return (
      normalizedSymbol === 'USDC' ||
      normalizedSymbol === 'USDC-TESTNET' ||
      normalizedSymbol === 'USDCTEST' ||
      normalizedSymbol.startsWith('USDC.') ||
      normalizedSymbol.includes('USDC')
    );
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
    
    // Convert addresses to new format with walletId per chain
    const circleWallet: { [blockchain: string]: ChainWallet } = {};
    for (const [blockchain, addrObj] of Object.entries(walletData.addresses)) {
      // addrObj may be { walletId, address }
      const walletId = (addrObj as any)?.walletId ?? walletData.id;
      const address = (addrObj as any)?.address ?? addrObj as unknown as string;
      circleWallet[blockchain] = {
        walletId,
        address,
      };
    }
    
    userWallet = {
      userId,
      role,
      circleWallet,
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
   * Get wallet by ID (searches across all chains)
   */
  async getWalletById(walletId: string): Promise<UserWallet | null> {
    for (const wallet of this.userWallets.values()) {
      // Check all chains for matching walletId
      for (const chainWallet of Object.values(wallet.circleWallet)) {
        if (chainWallet.walletId === walletId) {
          return wallet;
        }
      }
    }
    return null;
  }

  /**
   * Get Circle wallet ID (same across all chains for EOA wallets)
   * Used for querying multi-chain assets via Circle Wallet API
   */
  private getCircleWalletId(userWallet: UserWallet): string {
    const chainWallets = Object.values(userWallet.circleWallet);
    if (chainWallets.length === 0) {
      throw new NotFoundException('Wallet has no blockchain addresses configured');
    }
    // All chains share the same walletId for EOA wallets
    return (chainWallets[0] as ChainWallet).walletId;
  }

  /**
   * Get walletId for a specific chain (helper method)
   */
  private getWalletIdForChain(userWallet: UserWallet, blockchain: string = 'ARC-TESTNET'): string {
    const chainWallet = userWallet.circleWallet[blockchain];
    if (!chainWallet) {
      throw new NotFoundException(
        `No wallet found for blockchain ${blockchain}. Available chains: ${Object.keys(userWallet.circleWallet).join(', ')}`
      );
    }
    return chainWallet.walletId;
  }

  /**
   * Get address for a specific chain (helper method)
   */
  private getAddressForChain(userWallet: UserWallet, blockchain: string = 'ARC-TESTNET'): string {
    const chainWallet = userWallet.circleWallet[blockchain];
    if (!chainWallet) {
      throw new NotFoundException(
        `No wallet found for blockchain ${blockchain}. Available chains: ${Object.keys(userWallet.circleWallet).join(', ')}`
      );
    }
    return chainWallet.address;
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

    // Get any existing walletId (they should all be the same)
    const baseWalletId = Object.values(existingWallet.circleWallet)[0]?.walletId;
    
    this.logger.log(
      `Deriving wallet ${baseWalletId} on new blockchains: ${actuallyNewBlockchains.join(', ')}`
    );
    
    // Derive wallet on each new blockchain using Circle SDK
    const updatedCircleWallet = { ...(existingWallet.circleWallet || {}) };
    
    for (const blockchain of actuallyNewBlockchains) {
      try {
        const walletName = `${userId}-${role}`;
        const { walletId: newWalletId, address } = await this.circleWalletService.deriveWallet(
          baseWalletId,
          blockchain,
          walletName
        );
        updatedCircleWallet[blockchain] = {
          walletId: newWalletId,
          address,
        };
        this.logger.log(`Derived ${blockchain}: walletId=${newWalletId}, address=${address}`);
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
      `Blockchains added successfully. WalletId: ${baseWalletId} (unchanged), ` +
      `New blockchains: ${actuallyNewBlockchains.join(', ')}, ` +
      `Addresses: ${JSON.stringify(updatedCircleWallet)}`
    );
    
    return updatedWallet;
  }

  /**
   * Get address for specific blockchain
   */
  getAddressForBlockchain(wallet: UserWallet, blockchain: string): string | undefined {
    return wallet.circleWallet?.[blockchain]?.address;
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
      const circleAddresses = Object.values(wallet.circleWallet || {}).map(cw => cw.address);
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
   * Get wallet balance (aggregates USDC across all chains using Gateway API)
   * Used internally by getUserWallet when includeBalance=true
   */
  async getWalletBalance(userId: string, role: WalletRole = WalletRole.INVESTOR) {
    try {
      // Try to use Gateway API for unified USDC balance
      const unifiedBalance = await this.getUnifiedUSDCBalance(userId, role);
      return {
        balance: unifiedBalance.totalBalanceE6,
        balanceUSD: parseFloat(unifiedBalance.totalBalanceUSDC),
      };
    } catch (error) {
      this.logger.warn(`Failed to get unified balance via Gateway API, falling back to Wallet API`, error.message);
      
      // Fallback to Circle Wallet API - query all chains
      const userWallet = await this.getUserWallet(userId, role);
      let totalBalance = 0;
      
      for (const [blockchain, chainWallet] of Object.entries(userWallet.circleWallet) as [string, ChainWallet][]) {
        try {
          const tokenBalances = await this.circleWalletService.getWalletBalance(chainWallet.walletId);
          
          if (Array.isArray(tokenBalances)) {
            for (const tokenBalance of tokenBalances) {
              const symbol = tokenBalance.token?.symbol || '';
              const isUSDC = this.isUSDCToken(symbol);
              
              if (isUSDC && tokenBalance.amount) {
                const amount = Number(tokenBalance.amount);
                totalBalance += amount;
              }
            }
          }
        } catch (err) {
          this.logger.warn(`Failed to query balance for ${blockchain}:`, err.message);
        }
      }
      
      return {
        balance: (totalBalance * 1_000_000).toString(),
        balanceUSD: totalBalance,
      };
    }
  }

  /**
   * Get detailed wallet balance (per-chain breakdown with all assets)
   * Queries each chain's walletId separately and aggregates results
   * 
   * Recommended for testnet: Returns all tokens including USDC-TESTNET (18 decimals)
   * Use this API to see actual balances on testnets
   */
  async getDetailedWalletBalance(userId: string, role: WalletRole = WalletRole.INVESTOR) {
    const userWallet = await this.getUserWallet(userId, role);
    
    // Query each chain's wallet separately (each chain may have different walletId)
    const balancesByChain: { [chain: string]: any[] } = {};
    let totalUSDC = 0;
    let allTokenBalances: any[] = [];
    const walletIds = new Set<string>();
    const processedWalletIds = new Set<string>();

    for (const [blockchain, chainWallet] of Object.entries(userWallet.circleWallet) as [string, ChainWallet][]) {
      try {
        const walletId = chainWallet.walletId;
        this.logger.log(`Querying balance for ${blockchain} with walletId: ${walletId}`);

        // Some Circle wallet sets may reference the same walletId under multiple chain keys
        // (especially EOA wallets). Avoid querying the same walletId multiple times because
        // that would produce duplicate token balance entries in the aggregation.
        if (processedWalletIds.has(walletId)) {
          this.logger.log(`Skipping already-processed walletId=${walletId} for chain=${blockchain}`);
          continue;
        }
        processedWalletIds.add(walletId);
        walletIds.add(walletId);

        const tokenBalances = await this.circleWalletService.getWalletBalance(walletId);

        if (Array.isArray(tokenBalances) && tokenBalances.length > 0) {
          allTokenBalances = allTokenBalances.concat(tokenBalances);

          for (const tokenBalance of tokenBalances) {
            const tokenBlockchain = tokenBalance.token?.blockchain || blockchain;
            const symbol = tokenBalance.token?.symbol || '';
            const amount = Number(tokenBalance.amount || 0);

            if (!balancesByChain[tokenBlockchain]) {
              balancesByChain[tokenBlockchain] = [];
            }

            balancesByChain[tokenBlockchain].push({
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
            const isUSDC = this.isUSDCToken(symbol);
            if (isUSDC) {
              totalUSDC += amount;
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to query balance for ${blockchain}:`, error.message);
      }
    }
    
    return {
      userId,
      role,
      walletIds: Array.from(walletIds),
      summary: {
        totalUSDC: totalUSDC,
        totalUSDCE6: (totalUSDC * 1_000_000).toString(),
        chainsCount: Object.keys(balancesByChain).length,
        assetsCount: allTokenBalances.length,
      },
      balancesByChain,
      rawTokenBalances: allTokenBalances,
    };
  }

  /**
   * Get unified USDC balance across multiple chains using Circle Gateway API
   * 
   * ⚠️ IMPORTANT: Gateway API only supports standard USDC (6 decimals) via CCTP
   * For testnet native tokens like USDC-TESTNET (18 decimals), use getDetailedWalletBalance() instead
   * 
   * @param userId - User ID
   * @param role - Wallet role
   * @param chains - Optional list of chains to query (e.g., ['ARC-TESTNET', 'ETH-SEPOLIA'])
   */
  async getUnifiedUSDCBalance(
    userId: string,
    role: WalletRole = WalletRole.INVESTOR,
    chains?: WalletChain[],
  ) {
    const userWallet = await this.getUserWallet(userId, role);
    
    // Get any address from the wallet (all addresses are the same for EOA wallets)
    const addresses = Object.values(userWallet.circleWallet).map((cw: ChainWallet) => cw.address);
    if (addresses.length === 0) {
      throw new BadRequestException('Wallet has no addresses');
    }
    const depositorAddress = addresses[0] as string;
    
    // Query unified balance via Circle Gateway API
    const unifiedBalance = await this.circleGatewayService.getUnifiedUSDCBalance(
      depositorAddress,
      chains,
    );
    
    const walletId = this.getCircleWalletId(userWallet);
    return {
      userId,
      role,
      walletId,
      depositorAddress,
      ...unifiedBalance,
    };
  }

  /**
   * Get USDC balance on ARC-TESTNET chain (via blockchain query)
   */
  async getArcUSDCBalance(userId: string, role: WalletRole = WalletRole.INVESTOR) {
    const userWallet = await this.getUserWallet(userId, role);
    const arcAddress = this.getAddressForChain(userWallet, 'ARC-TESTNET');
    
    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }
    
    // Query USDC balance on Arc chain
    const balanceE6 = await this.arcContractService.getUSDCBalance(arcAddress);
    const balanceUSDC = (Number(balanceE6) / 1_000_000).toFixed(6);
    
    // Query USDC allowance for Ledger contract
    const allowanceE6 = await this.arcContractService.getUSDCAllowance(arcAddress);
    const allowanceUSDC = (Number(allowanceE6) / 1_000_000).toFixed(6);
    
    const walletId = this.getWalletIdForChain(userWallet, 'ARC-TESTNET');
    return {
      userId,
      role,
      walletId,
      chain: 'ARC-TESTNET',
      address: arcAddress,
      balance: {
        balanceE6,
        balanceUSDC,
      },
      allowance: {
        allowanceE6,
        allowanceUSDC,
      },
    };
  }
}
