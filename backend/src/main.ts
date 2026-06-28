import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '*').split(','),
    credentials: true,
  });

  // Reject any payload with unknown/invalid fields — input validation everywhere.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Redis-backed socket.io adapter so rooms scale across multiple instances.
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connect();
  app.useWebSocketAdapter(redisAdapter);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
