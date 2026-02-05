import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { UsersService, WalletRole } from './users.service';

@Controller('wallets')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Create or get wallet for user with specific role
   * POST /wallets/:userId?role=issuer&blockchains=ARC-TESTNET,ARB-SEPOLIA
   * POST /wallets/:userId?role=investor&blockchains=ARC-TESTNET
   */
  @Post(':userId')
  async createWallet(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
    @Query('blockchains') blockchains?: string,
  ) {
    const walletRole = this.parseRole(role);
    const blockchainList = blockchains ? blockchains.split(',').map(b => b.trim()) : ['ARC-TESTNET'];
    return this.usersService.getOrCreateWallet(userId, walletRole, blockchainList);
  }

  /**
   * Get specific role wallet for user
   * GET /wallets/:userId?role=issuer&includeBalance=true
   */
  @Get(':userId')
  async getWallet(
    @Param('userId') userId: string,
    @Query('role') role?: string,
    @Query('includeBalance') includeBalance?: string,
  ) {
    const shouldIncludeBalance = includeBalance === 'true';
    
    if (role) {
      const walletRole = this.parseRole(role);
      return this.usersService.getUserWallet(userId, walletRole, shouldIncludeBalance);
    }
    
    return this.usersService.getUserWallets(userId, shouldIncludeBalance);
  }

  /**
   * Get wallet balance - all assets on all chains (via Circle Wallet API)
   * GET /wallets/:userId/balance?role=investor
   */
  @Get(':userId/balance')
  async getAllAssetBalance(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
  ) {
    const walletRole = this.parseRole(role);
    return this.usersService.getDetailedWalletBalance(userId, walletRole);
  }

  /**
   * Get unified USDC balance across multiple chains (via Circle Gateway API)
   * GET /wallets/:userId/balance/usdc?role=investor&chains=ARC-TESTNET,ETH-SEPOLIA
   */
  @Get(':userId/balance/usdc')
  async getUnifiedUSDCBalance(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
    @Query('chains') chains?: string,
  ) {
    const walletRole = this.parseRole(role);
    const chainList = chains ? chains.split(',').map(c => c.trim()) : undefined;
    return this.usersService.getUnifiedUSDCBalance(userId, walletRole, chainList);
  }

  /**
   * Get USDC balance on ARC-TESTNET chain (via blockchain query)
   * GET /wallets/:userId/balance/arc?role=investor
   */
  @Get(':userId/balance/arc')
  async getArcUSDCBalance(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
  ) {
    const walletRole = this.parseRole(role);
    return this.usersService.getArcUSDCBalance(userId, walletRole);
  }

  /**
   * Add blockchains to existing wallet
   * POST /wallets/:userId/blockchains?role=issuer&blockchains=ARB-SEPOLIA,MATIC-AMOY
   */
  @Post(':userId/blockchains')
  async addBlockchains(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
    @Query('blockchains') blockchains: string,
  ) {
    if (!blockchains) {
      throw new Error('blockchains query parameter is required');
    }
    const walletRole = this.parseRole(role);
    const blockchainList = blockchains.split(',').map(b => b.trim());
    return this.usersService.addBlockchainToWallet(userId, walletRole, blockchainList);
  }

  /**
   * Parse role string to WalletRole enum
   */
  private parseRole(role: string): WalletRole {
    const normalizedRole = role.toLowerCase();
    
    switch (normalizedRole) {
      case 'issuer':
        return WalletRole.ISSUER;
      case 'investor':
        return WalletRole.INVESTOR;
      case 'admin':
        return WalletRole.ADMIN;
      default:
        return WalletRole.INVESTOR; // Default to investor
    }
  }
}
