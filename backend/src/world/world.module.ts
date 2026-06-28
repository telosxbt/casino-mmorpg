import { Global, Module } from '@nestjs/common';
import { MapService } from './map.service';
import { WorldService } from './world.service';
import { WorldGateway } from './world.gateway';

/**
 * Global so game gateways can inject MapService + WorldService for proximity
 * checks (a player may only join a table they're standing next to).
 */
@Global()
@Module({
  providers: [MapService, WorldService, WorldGateway],
  exports: [MapService, WorldService],
})
export class WorldModule {}
