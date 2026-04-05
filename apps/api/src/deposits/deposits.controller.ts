import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfirmedGuard } from '../auth/confirmed.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { DepositsService } from './deposits.service';

interface AuthenticatedRequest extends Request {
  user: { id: number; username: string; confirmed: boolean };
}

@SkipThrottle({ auth: true })
@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @UseGuards(JwtAuthGuard, ConfirmedGuard)
  @Post()
  createDeposit(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateDepositDto,
  ) {
    return this.depositsService.createDeposit(req.user.id, dto.amountSats, dto.currency);
  }

  @Get('status/:invoiceId')
  getInvoiceStatus(@Param('invoiceId') invoiceId: string) {
    return this.depositsService.getInvoiceStatus(invoiceId);
  }

  @UseGuards(JwtAuthGuard, ConfirmedGuard)
  @Get('transactions')
  getTransactions(@Req() req: AuthenticatedRequest) {
    return this.depositsService.getUserTransactions(req.user.id);
  }

  @UseGuards(JwtAuthGuard, ConfirmedGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  softDelete(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.depositsService.softDeleteTransaction(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard, ConfirmedGuard)
  @Get('balance')
  getUserBalance(@Req() req: AuthenticatedRequest) {
    return this.depositsService.getUserBalance(req.user.id);
  }
}
