import { Module } from '@nestjs/common';
import { RouletteService } from './roulette.service';
import { RouletteGateway } from './roulette.gateway';

@Module({
  providers: [RouletteService, RouletteGateway],
})
export class RouletteModule {}
