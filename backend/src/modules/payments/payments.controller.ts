import { Controller, Get, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { FundArcDto, SubscribeDto } from './dto/payment.dto';

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
  async declareDividend(
    @Body() body: { productId: number; amountE6: string; issuerAddress: string },
  ) {
    return this.paymentsService.declareDividend(
      body.productId,
      body.amountE6,
      body.issuerAddress,
    );
  }

  @Post('dividends/claim')
  async claimDividend(
    @Body() body: { userId: string; productId: number },
  ) {
    return this.paymentsService.claimDividend(body.userId, body.productId);
  }
}
