import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { NonceDto, VerifyDto, RefreshDto } from './dto';
import { RedisService } from '../redis/redis.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}

  @Post('nonce')
  async nonce(@Body() dto: NonceDto) {
    // Throttle nonce issuance per wallet to slow brute/spam.
    await this.guard(`nonce:${dto.walletAddress}`, 10, 60);
    return this.auth.issueNonce(dto.walletAddress);
  }

  @Post('verify')
  async verify(@Body() dto: VerifyDto) {
    await this.guard(`verify:${dto.walletAddress}`, 10, 60);
    return this.auth.verify(dto.walletAddress, dto.signature, dto.username);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(@Req() req: any) {
    await this.auth.logoutAll(req.user.sub);
    return { ok: true };
  }

  private async guard(key: string, limit: number, win: number) {
    const ok = await this.redis.allow(key, limit, win);
    if (!ok) throw new Error('rate limit exceeded');
  }
}
