import { Controller, Get, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { 
  DepositToGatewayDto,
  TransferToArcDto, 
  SubscribeDto, 
  DeclareDividendDto, 
  ClaimDividendDto 
} from './dto/payment.dto';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Gateway API
  @Post('gateway/deposit')
  async depositToGateway(@Body() dto: DepositToGatewayDto) {
    return this.paymentsService.depositToGateway(dto);
  }

  @Post('gateway/transfer-to-arc')
  async transferToArc(@Body() dto: TransferToArcDto) {
    return this.paymentsService.transferToArc(dto);
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
