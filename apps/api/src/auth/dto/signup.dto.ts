import { IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @MinLength(8)
  password!: string;
}
