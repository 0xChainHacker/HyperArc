import { Controller, Get, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  async createProduct(
    @Body() dto: CreateProductDto,
    @Query('walletId') walletId?: string,
  ) {
    return this.productsService.createProduct(dto, walletId);
  }

  @Get()
  async listProducts() {
    return this.productsService.listProducts();
  }

  @Get(':productId')
  async getProduct(@Param('productId', ParseIntPipe) productId: number) {
    return this.productsService.getProduct(productId);
  }

  @Get(':productId/total-units')
  async getTotalUnits(@Param('productId', ParseIntPipe) productId: number) {
    const totalUnits = await this.productsService.getProductTotalUnits(productId);
    return { productId, totalUnits };
  }
}
