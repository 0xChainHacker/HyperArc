import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get(':userId')
  async getPortfolio(@Param('userId') userId: string) {
    return this.portfolioService.getPortfolio(userId);
  }

  @Get(':userId/product/:productId')
  async getProductHolding(
    @Param('userId') userId: string,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.portfolioService.getProductHolding(userId, productId);
  }
}
