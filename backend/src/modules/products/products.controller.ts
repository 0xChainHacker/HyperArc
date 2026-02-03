import { Controller, Get, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/product.dto';

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
}
