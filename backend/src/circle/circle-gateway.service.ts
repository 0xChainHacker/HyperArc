import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreatePaymentIntentDto, GetPaymentDto } from './dto/gateway.dto';

@Injectable()
export class CircleGatewayService {
  private readonly logger = new Logger(CircleGatewayService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('CIRCLE_API_KEY');
    this.baseUrl = this.configService.get<string>('CIRCLE_API_BASE_URL');
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a payment intent for on-ramp
   */
  async createPaymentIntent(dto: CreatePaymentIntentDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/v1/paymentIntents`,
          {
            idempotencyKey: dto.idempotencyKey,
            amount: dto.amount,
            settlementCurrency: dto.settlementCurrency,
            paymentMethods: dto.paymentMethods,
            metadata: dto.metadata || {},
          },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Payment intent created: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to create payment intent', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get payment intent details
   */
  async getPaymentIntent(paymentIntentId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/paymentIntents/${paymentIntentId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get payment intent ${paymentIntentId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * List all payment intents
   */
  async listPaymentIntents(pageSize = 10, pageAfter?: string) {
    try {
      const params: any = { pageSize };
      if (pageAfter) params.pageAfter = pageAfter;

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/paymentIntents`,
          { 
            headers: this.getHeaders(),
            params,
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to list payment intents', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get payment by ID
   */
  async getPayment(dto: GetPaymentDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/payments/${dto.id}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get payment ${dto.id}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * List all payments
   */
  async listPayments(pageSize = 10, pageAfter?: string) {
    try {
      const params: any = { pageSize };
      if (pageAfter) params.pageAfter = pageAfter;

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/payments`,
          { 
            headers: this.getHeaders(),
            params,
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to list payments', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get supported payment methods
   */
  async getPaymentMethods() {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/paymentMethods`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get payment methods', error.response?.data || error.message);
      throw error;
    }
  }
}
