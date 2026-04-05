import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PricesService } from './prices.service';

@SkipThrottle({ auth: true })
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get()
  getRates() {
    return this.pricesService.getRates();
  }
}
