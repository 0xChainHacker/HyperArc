import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { CirclePaymentIntent, CirclePayment } from './circle.types';

type WalletChain = 'ETH-SEPOLIA' | 'BASE-SEPOLIA' | 'AVAX-FUJI' | 'ARC-TESTNET';

/**
 * Circle Gateway Service
 * Handles Payment API (for on-ramp), Gateway deposits, and cross-chain transfers
 */
@Injectable()
export class CircleGatewayService {
  private readonly logger = new Logger(CircleGatewayService.name);
  private readonly apiKey: string;
  private readonly entitySecret: string;
  private readonly baseUrl: string;
  private readonly circleDeveloperSdk: ReturnType<typeof initiateDeveloperControlledWalletsClient>;
  private readonly gatewayWalletAddress = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
  private readonly gatewayMinterAddress = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';
  private readonly gatewayApiUrl = 'https://gateway-api-testnet.circle.com/v1/transfer';
  
  // EIP-712 type definitions
  private readonly eip712Domain = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
  ];
  
  private readonly transferSpec = [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ];
  
  private readonly burnIntent = [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('circle.apiKey');
    this.entitySecret = this.configService.get<string>('circle.entitySecret');
    this.baseUrl = this.configService.get<string>('circle.apiBaseUrl');
    
    // Initialize Circle Developer SDK for contract execution
    this.circleDeveloperSdk = initiateDeveloperControlledWalletsClient({
      apiKey: this.apiKey,
      entitySecret: this.entitySecret,
    });
  }

  /**
   * Get authorization headers for Payment API
   */
  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Parse decimal amount to base units (e.g., "10.5" → "10500000")
   */
  private parseBalance(usdcStr: string): string {
    const [whole, decimal = ''] = String(usdcStr).split('.');
    const decimal6 = (decimal + '000000').slice(0, 6);
    return BigInt(whole + decimal6).toString();
  }

  /**
   * Convert number to USDC units (6 decimals)
   */
  private parseUSDC(amount: number): string {
    return BigInt(Math.floor(amount * 1_000_000)).toString();
  }

  /**
   * Convert address to bytes32 (left pad to 32 bytes)
   */
  private addressToBytes32(address: string): string {
    const hex = address.toLowerCase().replace(/^0x/, '');
    return '0x' + hex.padStart(64, '0');
  }

  /**
   * Convert hex string to bytes32
   */
  private bytes32FromHex(hex0x: string): string {
    const hex = hex0x.toLowerCase().replace(/^0x/, '');
    if (hex.length !== 64) {
      throw new Error(`bytes32 length invalid: ${hex0x}`);
    }
    return '0x' + hex;
  }

  /**
   * Build EIP-712 typed data for burn intent
   */
  private buildBurnIntentTypedData(burnIntent: any) {
    return {
      types: {
        EIP712Domain: this.eip712Domain,
        TransferSpec: this.transferSpec,
        BurnIntent: this.burnIntent,
      },
      domain: { name: 'GatewayWallet', version: '1' },
      primaryType: 'BurnIntent',
      message: {
        ...burnIntent,
        spec: {
          ...burnIntent.spec,
          sourceContract: this.addressToBytes32(burnIntent.spec.sourceContract),
          destinationContract: this.addressToBytes32(burnIntent.spec.destinationContract),
          sourceToken: this.addressToBytes32(burnIntent.spec.sourceToken),
          destinationToken: this.addressToBytes32(burnIntent.spec.destinationToken),
          sourceDepositor: this.addressToBytes32(burnIntent.spec.sourceDepositor),
          destinationRecipient: this.addressToBytes32(burnIntent.spec.destinationRecipient),
          sourceSigner: this.addressToBytes32(burnIntent.spec.sourceSigner),
          destinationCaller: this.addressToBytes32(burnIntent.spec.destinationCaller),
          salt: this.bytes32FromHex(burnIntent.spec.salt),
        },
      },
    };
  }

  /**
   * Wait for transaction to reach terminal state
   */
  private async waitForTxCompletion(txId: string, label: string): Promise<any> {
    const terminalStates = new Set(['COMPLETE', 'CONFIRMED', 'FAILED', 'DENIED', 'CANCELLED']);
    
    this.logger.log(`Waiting for ${label} (txId=${txId})`);

    while (true) {
      const { data } = await this.circleDeveloperSdk.getTransaction({ id: txId });
      const state = data?.transaction?.state;

      if (state && terminalStates.has(state)) {
        this.logger.log(`${label} final state: ${state}`);

        if (state !== 'COMPLETE' && state !== 'CONFIRMED') {
          throw new Error(`${label} did not complete successfully (state=${state})`);
        }
        return data.transaction;
      }
      
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
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
    this.logger.log(`Creating payment intent for user: ${userId}, amount: ${amount} ${currency}, chain: ${chain}`);
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
    this.logger.log(`Getting payment intent: ${paymentIntentId}`);
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

  /**
   * Approve USDC for Gateway Wallet (using SDK)
   */
  async approveUSDCForGateway(
    walletId: string,
    usdcAddress: string,
    amount: string,
  ): Promise<string> {
    this.logger.log(
      `Approving ${amount} USDC for Gateway Wallet ${this.gatewayWalletAddress}`
    );

    try {
      const approveTx = await this.circleDeveloperSdk.createContractExecutionTransaction({
        walletId,
        contractAddress: usdcAddress,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [
          this.gatewayWalletAddress,
          this.parseBalance(amount),
        ],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });

      const approveTxId = approveTx.data?.id;
      if (!approveTxId) {
        throw new Error('Failed to create approve transaction');
      }

      await this.waitForTxCompletion(approveTxId, 'USDC approve');
      return approveTxId;
    } catch (error) {
      this.logger.error('Failed to approve USDC', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Deposit USDC to Gateway Wallet (using SDK)
   */
  async depositToGateway(
    walletId: string,
    usdcAddress: string,
    amount: string,
  ): Promise<string> {
    this.logger.log(`Depositing ${amount} USDC to Gateway Wallet`);

    try {
      const depositTx = await this.circleDeveloperSdk.createContractExecutionTransaction({
        walletId,
        contractAddress: this.gatewayWalletAddress,
        abiFunctionSignature: 'deposit(address,uint256)',
        abiParameters: [
          usdcAddress,
          this.parseBalance(amount),
        ],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });

      const depositTxId = depositTx.data?.id;
      if (!depositTxId) {
        throw new Error('Failed to create deposit transaction');
      }

      await this.waitForTxCompletion(depositTxId, 'Gateway deposit');
      return depositTxId;
    } catch (error) {
      this.logger.error('Failed to deposit to Gateway', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Complete Gateway deposit flow (approve + deposit)
   */
  async completeGatewayDeposit(
    walletId: string,
    usdcAddress: string,
    amount: string,
  ): Promise<{ approveTxId: string; depositTxId: string }> {
    this.logger.log(`Starting Gateway deposit flow for ${amount} USDC`);

    // Step 1: Approve USDC
    const approveTxId = await this.approveUSDCForGateway(walletId, usdcAddress, amount);

    // Step 2: Deposit to Gateway
    const depositTxId = await this.depositToGateway(walletId, usdcAddress, amount);

    this.logger.log(
      'Gateway deposit complete. Unified USDC balance will be credited after finality.'
    );

    return { approveTxId, depositTxId };
  }

  /**
   * Cross-chain transfer using Gateway API
   * @param sourceWalletId - Source chain wallet ID
   * @param sourceDomain - Source chain domain number
   * @param sourceUsdcAddress - Source chain USDC token address
   * @param destinationWalletId - Destination chain wallet ID
   * @param destinationDomain - Destination chain domain number
   * @param destinationUsdcAddress - Destination chain USDC token address
   * @param destinationBlockchain - Destination blockchain for mint (e.g., 'BASE-SEPOLIA')
   * @param recipientAddress - Final recipient address on destination chain
   * @param amount - Amount in USDC (e.g., 0.5)
   * @param maxFee - Maximum fee willing to pay (in USDC base units, e.g., "2010000")
   */
  async crossChainTransfer(params: {
    sourceWalletId: string;
    sourceDomain: number;
    sourceUsdcAddress: string;
    destinationWalletId: string;
    destinationDomain: number;
    destinationUsdcAddress: string;
    destinationBlockchain: WalletChain;
    recipientAddress: string;
    amount: number;
    maxFee?: string;
  }): Promise<{ attestation: string; mintTxId: string }> {
    const {
      sourceWalletId,
      sourceDomain,
      sourceUsdcAddress,
      destinationWalletId,
      destinationDomain,
      destinationUsdcAddress,
      destinationBlockchain,
      recipientAddress,
      amount,
      maxFee = '2010000',
    } = params;

    this.logger.log(
      `Starting cross-chain transfer: ${amount} USDC from domain ${sourceDomain} to ${destinationDomain}`
    );

    // Step 1: Get source wallet address
    const srcWallet = await this.circleDeveloperSdk.getWallet({ id: sourceWalletId });
    const srcAddress = srcWallet.data?.wallet?.address;

    if (!srcAddress) {
      throw new Error(`Could not find wallet address for ${sourceWalletId}`);
    }

    this.logger.log(`Source wallet address: ${srcAddress}`);

    // Step 2: Build burn intent
    const maxUint256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const rawBurnIntent = {
      maxBlockHeight: maxUint256,
      maxFee,
      spec: {
        version: 1,
        sourceDomain,
        destinationDomain,
        sourceContract: this.gatewayWalletAddress,
        destinationContract: this.gatewayMinterAddress,
        sourceToken: sourceUsdcAddress,
        destinationToken: destinationUsdcAddress,
        sourceDepositor: srcAddress,
        destinationRecipient: recipientAddress,
        sourceSigner: srcAddress,
        destinationCaller: '0x0000000000000000000000000000000000000000',
        value: this.parseUSDC(amount),
        salt: '0x' + randomBytes(32).toString('hex'),
        hookData: '0x',
      },
    };

    // Step 3: Build EIP-712 typed data
    const typedData = this.buildBurnIntentTypedData(rawBurnIntent);

    // Step 4: Sign typed data
    this.logger.log('Signing typed data...');
    const sigResp = await this.circleDeveloperSdk.signTypedData({
      walletId: sourceWalletId,
      data: JSON.stringify(typedData),
    });

    const signature = sigResp.data?.signature;
    if (!signature) {
      throw new Error('Signature failed');
    }

    // Step 5: Submit to Gateway API
    this.logger.log('Submitting to Gateway API...');
    const response = await fetch(this.gatewayApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ burnIntent: typedData.message, signature }]),
    });

    const body = await response.json();
    const result = Array.isArray(body) ? body[0] : body;

    if (!response.ok || !result?.attestation) {
      this.logger.error('Gateway API error:', JSON.stringify(body, null, 2));
      throw new Error(`Gateway API error: ${JSON.stringify(body)}`);
    }

    this.logger.log('Attestation received');

    // Step 6: Mint on destination chain
    this.logger.log(`Minting on destination chain (${destinationBlockchain})...`);
    const mintTx = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId: destinationWalletId,
      contractAddress: this.gatewayMinterAddress,
      abiFunctionSignature: 'gatewayMint(bytes,bytes)',
      abiParameters: [result.attestation, result.signature],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const mintTxId = mintTx.data?.id;
    if (!mintTxId) {
      throw new Error('Failed to create mint transaction');
    }

    this.logger.log(`Mint transaction created: ${mintTxId}`);

    return {
      attestation: result.attestation,
      mintTxId,
    };
  }
}
