import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [ChainModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
