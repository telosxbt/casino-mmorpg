import { Global, Module } from '@nestjs/common';
import { FairnessService } from './fairness.service';

@Global()
@Module({
  providers: [FairnessService],
  exports: [FairnessService],
})
export class FairnessModule {}
