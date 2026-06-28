import { Module } from '@nestjs/common';
import { SlotsService } from './slots.service';
import { SlotsController } from './slots.controller';

@Module({
  providers: [SlotsService],
  controllers: [SlotsController],
})
export class SlotsModule {}
