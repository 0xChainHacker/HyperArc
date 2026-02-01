import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CircleGatewayService } from './circle-gateway.service';
import { CreatePaymentIntentDto } from './dto/gateway.dto';

@Controller('circle/gateway')
export class CircleGatewayController {
  constructor(private readonly gatewayService: CircleGatewayService) {}

  @Post('payment-intents')
  async createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.gatewayService.createPaymentIntent(dto);
  }

  @Get('payment-intents')
  async listPaymentIntents(
    @Query('pageSize') pageSize?: number,
    @Query('pageAfter') pageAfter?: string,
  ) {
    return this.gatewayService.listPaymentIntents(pageSize, pageAfter);
  }

  @Get('payment-intents/:id')
  async getPaymentIntent(@Param('id') id: string) {
    return this.gatewayService.getPaymentIntent(id);
  }

  @Get('payments')
  async listPayments(
    @Query('pageSize') pageSize?: number,
    @Query('pageAfter') pageAfter?: string,
  ) {
    return this.gatewayService.listPayments(pageSize, pageAfter);
  }

  @Get('payments/:id')
  async getPayment(@Param('id') id: string) {
    return this.gatewayService.getPayment({ id });
  }

  @Get('payment-methods')
  async getPaymentMethods() {
    return this.gatewayService.getPaymentMethods();
  }
}
