import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ArcContractService } from './arc-contract.service';

@Module({
  imports: [ConfigModule],
  providers: [ArcContractService],
  exports: [ArcContractService],
})
export class ChainModule {}
