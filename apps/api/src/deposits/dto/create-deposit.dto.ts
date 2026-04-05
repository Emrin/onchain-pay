import { IsIn, IsInt, Max, Min } from 'class-validator';

export class CreateDepositDto {
  @IsInt()
  @Min(546)
  @Max(100000000000000)
  amountSats!: number;

  @IsIn(['BTC', 'LTC', 'XMR'])
  currency!: string;
}
