import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, Length, Matches } from 'class-validator';
import { RedisService } from '../../redis/redis.service';
import { MapService } from '../../world/map.service';
import { WorldService } from '../../world/world.service';
import { SlotsService } from './slots.service';

class SpinDto {
  @IsString()
  @Length(1, 40)
  machineId!: string;

  @Matches(/^[1-9][0-9]{0,30}$/, { message: 'bet must be a positive integer (base units)' })
  bet!: string;
}

/**
 * Slots are single-player → a simple authenticated HTTP endpoint. The player
 * must be standing next to the machine (anti-cheat via the world position).
 */
@UseGuards(AuthGuard('jwt'))
@Controller('slots')
export class SlotsController {
  constructor(
    private readonly slots: SlotsService,
    private readonly redis: RedisService,
    private readonly map: MapService,
    private readonly world: WorldService,
  ) {}

  @Post('spin')
  async spin(@Req() req: any, @Body() dto: SpinDto) {
    if (!(await this.redis.allow(`slots:${req.user.sub}`, 10, 10))) {
      throw new BadRequestException('rate limit exceeded');
    }
    const machine = this.map.interactable(dto.machineId);
    if (!machine || machine.type !== 'SLOTS') throw new BadRequestException('unknown machine');

    const me = this.world.get(req.user.sub);
    if (!me || !this.map.isNear({ x: Math.round(me.x), y: Math.round(me.y) }, machine)) {
      throw new BadRequestException('walk up to the machine first');
    }
    return this.slots.spin(req.user.sub, dto.machineId, BigInt(dto.bet));
  }
}
