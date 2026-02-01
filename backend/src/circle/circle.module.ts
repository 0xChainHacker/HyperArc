import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CircleWalletService } from './circle-wallet.service';
import { CircleGatewayService } from './circle-gateway.service';
import { CircleWalletController } from './circle-wallet.controller';
import { CircleGatewayController } from './circle-gateway.controller';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
  ],
  controllers: [
    CircleWalletController,
    CircleGatewayController,
  ],
  providers: [
    CircleWalletService,
    CircleGatewayService,
  ],
  exports: [
    CircleWalletService,
    CircleGatewayService,
  ],
})
export class CircleModule {}
