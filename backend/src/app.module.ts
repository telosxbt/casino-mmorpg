import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { FairnessModule } from './fairness/fairness.module';
import { WalletModule } from './wallet/wallet.module';
import { WorldModule } from './world/world.module';
import { ChatModule } from './chat/chat.module';
import { SlotsModule } from './games/slots/slots.module';
import { RouletteModule } from './games/roulette/roulette.module';
import { BlackjackModule } from './games/blackjack/blackjack.module';
import { LobbyModule } from './lobby/lobby.module';
import { configValidationSchema } from './common/config.validation';
import { HealthController } from './common/health.controller';
import { FairnessController } from './fairness/fairness.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: configValidationSchema,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    FairnessModule,
    WalletModule,
    WorldModule,
    ChatModule,
    SlotsModule,
    RouletteModule,
    BlackjackModule,
    LobbyModule,
  ],
  controllers: [HealthController, FairnessController],
})
export class AppModule {}
