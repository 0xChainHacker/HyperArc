import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CircleWalletService } from './circle-wallet.service';
import { CreateWalletDto, CreateWalletSetDto } from './dto/create-wallet.dto';
import { CreateTransactionDto, SignMessageDto } from './dto/transaction.dto';

@Controller('circle/wallet')
export class CircleWalletController {
  constructor(private readonly walletService: CircleWalletService) {}

  @Post('sets')
  async createWalletSet(@Body() dto: CreateWalletSetDto) {
    return this.walletService.createWalletSet(dto);
  }

  @Post()
  async createWallet(@Body() dto: CreateWalletDto) {
    return this.walletService.createWallet(dto);
  }

  @Get()
  async listWallets(
    @Query('pageSize') pageSize?: number,
    @Query('pageBefore') pageBefore?: string,
  ) {
    return this.walletService.listWallets(pageSize, pageBefore);
  }

  @Get(':walletId')
  async getWallet(@Param('walletId') walletId: string) {
    return this.walletService.getWallet(walletId);
  }

  @Get(':walletId/balance')
  async getWalletBalance(@Param('walletId') walletId: string) {
    return this.walletService.getWalletBalance(walletId);
  }

  @Post('transactions')
  async createTransaction(@Body() dto: CreateTransactionDto) {
    return this.walletService.createTransaction(dto);
  }

  @Get('transactions/:transactionId')
  async getTransaction(@Param('transactionId') transactionId: string) {
    return this.walletService.getTransaction(transactionId);
  }

  @Post('sign')
  async signMessage(@Body() dto: SignMessageDto) {
    return this.walletService.signMessage(dto);
  }
}
