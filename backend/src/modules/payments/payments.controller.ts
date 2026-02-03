import { Controller, Get, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { FundArcDto, SubscribeDto, DeclareDividendDto, ClaimDividendDto } from './dto/payment.dto';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Gateway API
  @Post('gateway/fund-arc')
  async fundArc(@Body() dto: FundArcDto) {
    return this.paymentsService.fundArc(dto);
  }

  @Get('gateway/transactions/:txId')
  async getGatewayTransaction(@Param('txId') txId: string) {
    return this.paymentsService.getGatewayTransaction(txId);
  }

  // Investment API
  @Post('invest/subscribe')
  async subscribe(@Body() dto: SubscribeDto) {
    return this.paymentsService.subscribe(dto);
  }

  // Dividends API
  @Post('dividends/declare')
  async declareDividend(@Body() dto: DeclareDividendDto) {
    return this.paymentsService.declareDividend(dto);
  }

  @Post('dividends/claim')
  async claimDividend(@Body() dto: ClaimDividendDto) {
    return this.paymentsService.claimDividend(dto.userId, dto.productId);
  }
}
