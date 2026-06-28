import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RouletteModule } from '../games/roulette/roulette.module';
import { BlackjackModule } from '../games/blackjack/blackjack.module';
import { LobbyService } from './lobby.service';
import { LobbyGateway } from './lobby.gateway';

@Module({
  imports: [JwtModule.register({}), RouletteModule, BlackjackModule],
  providers: [LobbyService, LobbyGateway],
})
export class LobbyModule {}
