import { Module } from '@nestjs/common';
import { BlackjackService } from './blackjack.service';
import { BlackjackGateway } from './blackjack.gateway';

@Module({
  providers: [BlackjackService, BlackjackGateway],
})
export class BlackjackModule {}
