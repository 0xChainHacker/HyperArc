import { Module } from '@nestjs/common';
import { CircleModule } from '../circle/circle.module';
import { ChainModule } from '../chain/chain.module';
import { UsersModule } from '../users/users.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [CircleModule, ChainModule, UsersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
