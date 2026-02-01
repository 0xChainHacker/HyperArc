import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CircleWalletService } from './circle-wallet.service';
import { CircleGatewayService } from './circle-gateway.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [CircleWalletService, CircleGatewayService],
  exports: [CircleWalletService, CircleGatewayService],
})
export class CircleModule {}
