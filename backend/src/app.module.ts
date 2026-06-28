import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { configValidationSchema } from './common/config.validation';
import { HealthController } from './common/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: configValidationSchema,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    // Phase 2+: WorldModule, ChatModule, WalletModule,
    // RouletteModule, BlackjackModule, SlotsModule, FairnessModule.
  ],
  controllers: [HealthController],
})
export class AppModule {}
