import { Module } from '@nestjs/common';
import { CircleModule } from '../circle/circle.module';
import { ChainModule } from '../chain/chain.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { KVService } from '../kv/kv.service';

@Module({
  imports: [CircleModule, ChainModule],
  controllers: [UsersController],
  providers: [UsersService, KVService],
  exports: [UsersService, KVService],
})
export class UsersModule {}
