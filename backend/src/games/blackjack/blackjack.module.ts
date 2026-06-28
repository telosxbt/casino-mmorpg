import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BlackjackService } from './blackjack.service';
import { BlackjackGateway } from './blackjack.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [BlackjackService, BlackjackGateway],
  exports: [BlackjackService],
})
export class BlackjackModule {}
