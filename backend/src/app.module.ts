import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { circleConfig } from './config/circle.config';
import { appConfig } from './config/app.config';
import { CircleModule } from './modules/circle/circle.module';
import { ChainModule } from './modules/chain/chain.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [circleConfig, appConfig],
    }),
    CircleModule,
    ChainModule,
    UsersModule,
    ProductsModule,
    PaymentsModule,
    PortfolioModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
