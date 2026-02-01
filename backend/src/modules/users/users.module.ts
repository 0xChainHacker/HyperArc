import { Module } from '@nestjs/common';
import { CircleModule } from '../circle/circle.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [CircleModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
