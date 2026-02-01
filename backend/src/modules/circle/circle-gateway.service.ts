import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CirclePaymentIntent, CirclePayment } from './circle.types';

@Injectable()
export class CircleGatewayService {
  private readonly logger = new Logger(CircleGatewayService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('circle.apiKey');
    this.baseUrl = this.configService.get<string>('circle.apiBaseUrl');
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
  async createPaymentIntent(
    userId: string,
    amount: string,
    currency: string,
    chain: string,
  ): Promise<CirclePaymentIntent> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/v1/paymentIntents`,
          {
            idempotencyKey: `payment-${userId}-${Date.now()}`,
            amount: {
              amount,
              currency,
            },
            settlementCurrency: currency,
            paymentMethods: [{
              type: 'blockchain',
              chain,
            }],
            metadata: { userId },
          },
          { headers: this.getHeaders() },
        ),
      );
      this.logger.log(`Payment intent created: ${response.data.data.id}`);
      return response.data.data;
    } catch (error) {
      this.logger.error('Failed to create payment intent', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get payment intent details
   */
  async getPaymentIntent(paymentIntentId: string): Promise<CirclePaymentIntent> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/paymentIntents/${paymentIntentId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data.data;
    } catch (error) {
      this.logger.error(`Failed to get payment intent ${paymentIntentId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<CirclePayment> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/v1/payments/${paymentId}`,
          { headers: this.getHeaders() },
        ),
      );
      return response.data.data;
    } catch (error) {
      this.logger.error(`Failed to get payment ${paymentId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * List payments for a user
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
      return response.data.data;
    } catch (error) {
      this.logger.error('Failed to list payments', error.response?.data || error.message);
      throw error;
    }
  }
}
