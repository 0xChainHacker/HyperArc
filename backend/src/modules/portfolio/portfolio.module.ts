import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';

@Module({
  imports: [ChainModule, ProductsModule, UsersModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
