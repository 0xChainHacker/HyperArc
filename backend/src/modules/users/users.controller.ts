import { Controller, Get, Post, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('wallets')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':userId')
  async createWallet(@Param('userId') userId: string) {
    return this.usersService.getOrCreateWallet(userId);
  }

  @Get(':userId')
  async getWallet(@Param('userId') userId: string) {
    return this.usersService.getUserWallet(userId);
  }

  @Get(':userId/balance')
  async getBalance(@Param('userId') userId: string) {
    return this.usersService.getWalletBalance(userId);
  }
}
