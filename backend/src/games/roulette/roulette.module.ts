import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RouletteService } from './roulette.service';
import { RouletteGateway } from './roulette.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [RouletteService, RouletteGateway],
})
export class RouletteModule {}
