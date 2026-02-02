import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { UsersService, WalletRole } from './users.service';

@Controller('wallets')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Create or get wallet for user with specific role
   * GET /wallets/:userId?role=issuer
   * GET /wallets/:userId?role=investor
   */
  @Post(':userId')
  async createWallet(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
  ) {
    const walletRole = this.parseRole(role);
    return this.usersService.getOrCreateWallet(userId, walletRole);
  }

  /**
   * Get specific role wallet for user
   * GET /wallets/:userId?role=issuer
   */
  @Get(':userId')
  async getWallet(
    @Param('userId') userId: string,
    @Query('role') role?: string,
  ) {
    if (role) {
      const walletRole = this.parseRole(role);
      return this.usersService.getUserWallet(userId, walletRole);
    }
    
    return this.usersService.getUserWallets(userId);
  }

  /**
   * Get wallet balance
   * GET /wallets/:userId/balance?role=investor
   */
  @Get(':userId/balance')
  async getBalance(
    @Param('userId') userId: string,
    @Query('role') role: string = 'investor',
  ) {
    const walletRole = this.parseRole(role);
    return this.usersService.getWalletBalance(userId, walletRole);
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
