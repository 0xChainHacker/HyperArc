import { Controller, Get, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto, RefundDto, WithdrawFundsDto } from './dto/product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * Create a new product (pending admin approval)
   * Requires issuerUserId - the user ID of the SPV/issuer creating the product
   */
  @Post()
  async createProduct(
    @Body() dto: CreateProductDto,
    @Body('issuerUserId') issuerUserId: string,
  ) {
    return this.productsService.createProduct(dto, issuerUserId);
  }

  @Get()
  async listProducts() {
    return this.productsService.listProducts();
  }

  @Get('pending')
  async getPendingProducts() {
    return this.productsService.getPendingProducts();
  }

  @Get(':productId')
  async getProduct(@Param('productId', ParseIntPipe) productId: number) {
    return this.productsService.getProduct(productId);
  }

  @Post(':productId/approve')
  async approveProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body('adminUserId') adminUserId: string,
  ) {
    return this.productsService.approveProduct(productId, adminUserId);
  }

  @Post(':productId/reject')
  async rejectProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body('adminUserId') adminUserId: string,
    @Body('reason') reason?: string,
  ) {
    return this.productsService.rejectProduct(productId, adminUserId, reason);
  }

  @Get(':productId/total-units')
  async getTotalUnits(@Param('productId', ParseIntPipe) productId: number) {
    const totalUnits = await this.productsService.getProductTotalUnits(productId);
    return { productId, totalUnits };
  }

  /**
   * Deactivate product to prevent new investments
   * Required before refunding investors
   */
  @Post(':productId/deactivate')
  async deactivateProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body('issuerUserId') issuerUserId: string,
  ) {
    return this.productsService.deactivateProduct(productId, issuerUserId);
  }

  /**
   * Refund investor by burning units and returning USDC
   * Product must be deactivated first
   */
  @Post(':productId/refund')
  async refundInvestor(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: RefundDto,
  ) {
    return this.productsService.refundInvestor(productId, dto);
  }

  /**
   * Withdraw subscription funds from contract
   * Issuer withdraws USDC from the contract treasury
   */
  @Post(':productId/withdraw')
  async withdrawFunds(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: WithdrawFundsDto,
  ) {
    return this.productsService.withdrawSubscriptionFunds(productId, dto);
  }
}
