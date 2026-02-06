import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { CirclePaymentIntent, CirclePayment } from './circle.types';

export enum WalletChain {
  ARC_TESTNET = 'ARC-TESTNET',
  ETH_SEPOLIA = 'ETH-SEPOLIA',
  AVAX_FUJI = 'AVAX-FUJI',
  BASE_SEPOLIA = 'BASE-SEPOLIA',
}

type GatewayTransferRequestItem = {
  burnIntent: {
    maxBlockHeight: string;
    maxFee: string;
    spec: {
      version: number;
      sourceDomain: number;
      destinationDomain: number;
      sourceContract: string; // bytes32 (0x + 64 hex)
      destinationContract: string; // bytes32
      sourceToken: string; // bytes32
      destinationToken: string; // bytes32
      sourceDepositor: string; // bytes32
      destinationRecipient: string; // bytes32
      sourceSigner: string; // bytes32
      destinationCaller: string; // bytes32
      value: string; // uint256
      salt: string; // bytes32
      hookData: string; // bytes
    };
  };
  signature: string;
};

type GatewayTransferResponse = {
  transferId: string;
  attestation: string;
  signature: string; // operator signature
  fees?: any;
  expirationBlock?: string;
};

@Injectable()
export class CircleGatewayService {
  private readonly logger = new Logger(CircleGatewayService.name);

  private readonly apiKey: string;
  private readonly entitySecret: string;
  private readonly baseUrl: string;

  private readonly circleDeveloperSdk: ReturnType<typeof initiateDeveloperControlledWalletsClient>;

  // Arc Testnet (Domain 26) – from Arc docs
  private readonly gatewayWalletAddress = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
  private readonly gatewayMinterAddress = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';

  // Circle Gateway API hosts
  private readonly gatewayApiUrl = 'https://gateway-api-testnet.circle.com/v1/transfer';
  private readonly gatewayBalanceApiUrl = 'https://gateway-api-testnet.circle.com/v1/balances';

  // Chain domain mapping (Circle Gateway domains)
  private readonly chainDomains: Record<WalletChain, { domain: number; name: string }> = {
    'ETH-SEPOLIA': { domain: 0, name: 'Ethereum Sepolia' },
    'AVAX-FUJI': { domain: 1, name: 'Avalanche Fuji' },
    'BASE-SEPOLIA': { domain: 6, name: 'Base Sepolia' },
    'ARC-TESTNET': { domain: 26, name: 'Arc Testnet' },
  };

  // ✅ USDC contract addresses (ERC-20 USDC on each chain)
  // Arc Testnet USDC is the ERC-20 interface for native USDC (6 decimals)
  private readonly usdcAddresses: Record<WalletChain, string> = {
    'ETH-SEPOLIA': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    'BASE-SEPOLIA': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    'AVAX-FUJI': '0x5425890298aed601595a70AB815c96711a31Bc65',
    'ARC-TESTNET': '0x3600000000000000000000000000000000000000', // ✅ correct for Arc Testnet USDC ERC-20 interface (6 decimals)
  };

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
    this.apiKey = this.configService.get<string>('circle.apiKey') ?? '';
    this.entitySecret = this.configService.get<string>('circle.entitySecret') ?? '';
    this.baseUrl = this.configService.get<string>('circle.apiBaseUrl') ?? '';

    if (!this.apiKey || !this.entitySecret) {
      this.logger.warn('Circle API key / entity secret is missing. Check env config.');
    }

    // Initialize Circle Developer SDK for contract execution & signing
    this.circleDeveloperSdk = initiateDeveloperControlledWalletsClient({
      apiKey: this.apiKey,
      entitySecret: this.entitySecret,
    });
  }

  /**
   * Payment API auth headers
   */
  private getPaymentHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Parse decimal string amount to base units (USDC 6 decimals)
   * "10.5" -> "10500000"
   */
  private parseBalance(usdcStr: string): string {
    const [whole, decimal = ''] = String(usdcStr).split('.');
    const decimal6 = (decimal + '000000').slice(0, 6);
    const normalizedWhole = whole === '' ? '0' : whole;
    return BigInt(normalizedWhole + decimal6).toString();
  }

  /**
   * Parse number to USDC base units (6 decimals)
   * NOTE: avoid floating rounding issues by rounding to nearest micro
   */
  private parseUSDC(amount: number): string {
    const micros = Math.round(amount * 1_000_000);
    if (micros < 0) throw new Error('Amount must be non-negative');
    return BigInt(micros).toString();
  }

  /**
   * Convert address to bytes32 (left pad to 32 bytes)
   */
  private addressToBytes32(address: string): string {
    const hex = address.toLowerCase().replace(/^0x/, '');
    if (hex.length !== 40) {
      throw new Error(`Invalid address: ${address}`);
    }
    return '0x' + hex.padStart(64, '0');
  }

  /**
   * Convert hex string to bytes32 (must be 32 bytes)
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

  // ----------------------------------------------------------------------------
  // Payment API (optional; keep as you had)
  // ----------------------------------------------------------------------------

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
            amount: { amount, currency },
            settlementCurrency: currency,
            paymentMethods: [{ type: 'blockchain', chain }],
            metadata: { userId },
          },
          { headers: this.getPaymentHeaders() },
        ),
      );
      this.logger.log(`Payment intent created: ${response.data.data.id}`);
      return response.data.data;
    } catch (error: any) {
      this.logger.error('Failed to create payment intent', error.response?.data || error.message);
      throw error;
    }
  }

  async getPaymentIntent(paymentIntentId: string): Promise<CirclePaymentIntent> {
    this.logger.log(`Getting payment intent: ${paymentIntentId}`);
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/paymentIntents/${paymentIntentId}`, {
          headers: this.getPaymentHeaders(),
        }),
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to get payment intent ${paymentIntentId}`, error.response?.data || error.message);
      throw error;
    }
  }

  async getPayment(paymentId: string): Promise<CirclePayment> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/payments/${paymentId}`, {
          headers: this.getPaymentHeaders(),
        }),
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to get payment ${paymentId}`, error.response?.data || error.message);
      throw error;
    }
  }

  async listPayments(pageSize = 10, pageAfter?: string) {
    try {
      const params: any = { pageSize };
      if (pageAfter) params.pageAfter = pageAfter;

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/payments`, {
          headers: this.getPaymentHeaders(),
          params,
        }),
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error('Failed to list payments', error.response?.data || error.message);
      throw error;
    }
  }

  // ----------------------------------------------------------------------------
  // Gateway deposit (approve + deposit) on a source chain
  // ----------------------------------------------------------------------------

  /**
   * Approve USDC for Gateway Wallet (using Circle Developer Controlled Wallets SDK)
   */
  async approveUSDCForGateway(walletId: string, usdcAddress: string, amount: string): Promise<string> {
    this.logger.log(`Approving ${amount} USDC for GatewayWallet ${this.gatewayWalletAddress}`);

    try {
      const approveTx = await this.circleDeveloperSdk.createContractExecutionTransaction({
        walletId,
        contractAddress: usdcAddress,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [this.gatewayWalletAddress, this.parseBalance(amount)],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });

      const approveTxId = approveTx.data?.id;
      if (!approveTxId) throw new Error('Failed to create approve transaction');

      await this.waitForTxCompletion(approveTxId, 'USDC approve');
      return approveTxId;
    } catch (error: any) {
      this.logger.error('Failed to approve USDC', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Deposit USDC to Gateway Wallet (using SDK)
   */
  async depositToGateway(walletId: string, usdcAddress: string, amount: string): Promise<string> {
    this.logger.log(`Depositing ${amount} USDC to GatewayWallet`);

    try {
      const depositTx = await this.circleDeveloperSdk.createContractExecutionTransaction({
        walletId,
        contractAddress: this.gatewayWalletAddress,
        abiFunctionSignature: 'deposit(address,uint256)',
        abiParameters: [usdcAddress, this.parseBalance(amount)],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });

      const depositTxId = depositTx.data?.id;
      if (!depositTxId) throw new Error('Failed to create deposit transaction');

      await this.waitForTxCompletion(depositTxId, 'Gateway deposit');
      return depositTxId;
    } catch (error: any) {
      this.logger.error('Failed to deposit to Gateway', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Complete Gateway deposit flow (approve + deposit)
   */
  async completeGatewayDeposit(walletId: string, usdcAddress: string, amount: string) {
    this.logger.log(`Starting Gateway deposit flow: ${amount} USDC`);

    const approveTxId = await this.approveUSDCForGateway(walletId, usdcAddress, amount);
    const depositTxId = await this.depositToGateway(walletId, usdcAddress, amount);

    this.logger.log('Gateway deposit done. Unified balance will be credited after finality.');
    return { approveTxId, depositTxId };
  }

  // ----------------------------------------------------------------------------
  // Gateway transfer: burn intent -> attestation -> mint on Arc
  // ----------------------------------------------------------------------------

  /**
   * Submit burnIntent to Circle Gateway API and get attestation + operator signature
   */
  private async createTransferAttestation(
    burnIntentMessage: any,
    signature: string,
  ): Promise<GatewayTransferResponse> {
    // API expects an array of items (even for single intent)
    const payload: GatewayTransferRequestItem[] = [
      {
        burnIntent: burnIntentMessage,
        signature,
      },
    ];

    try {
      const resp = await firstValueFrom(
        this.httpService.post<GatewayTransferResponse>(
          this.gatewayApiUrl,
          payload,
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const data = resp.data as any;
      if (!data?.attestation || !data?.signature) {
        throw new Error(`Gateway API response missing attestation/signature: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (error: any) {
      this.logger.error('Gateway API /transfer failed', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Cross-chain transfer using Gateway API
   * NOTE: You must deposit USDC to Gateway Wallet first using completeGatewayDeposit()
   * 
   * This method performs:
   * 1. Build burn intent and sign (EIP-712)
   * 2. Submit to Gateway API to get attestation + operator signature
   * 3. Mint on Arc via GatewayMinter.gatewayMint(attestation, operatorSignature)
   */
  async crossChainTransferToArc(params: {
    sourceWalletId: string;
    sourceDomain: number;
    sourceUsdcAddress: string;
    destinationWalletId: string; // Arc walletId (minter caller)
    recipientAddress: string; // final recipient on Arc (EOA or contract)
    amount: number;
    maxFee?: string; // base units e6, e.g. "2010000"
  }): Promise<{ attestation: string; operatorSignature: string; mintTxId: string; transferId: string }> {
    const {
      sourceWalletId,
      sourceDomain,
      sourceUsdcAddress,
      destinationWalletId,
      recipientAddress,
      amount,
      maxFee = '2010000',
    } = params;

    const destinationDomain = this.chainDomains[WalletChain.ARC_TESTNET].domain;
    const destinationUsdcAddress = this.getUSDCAddress(WalletChain.ARC_TESTNET);

    this.logger.log(`Starting transfer to Arc: ${amount} USDC from domain ${sourceDomain} -> ${destinationDomain}`);

    // 1) get source wallet address
    const srcWallet = await this.circleDeveloperSdk.getWallet({ id: sourceWalletId });
    const srcAddress = srcWallet.data?.wallet?.address;
    if (!srcAddress) throw new Error(`Could not find wallet address for ${sourceWalletId}`);

    // 2) build burn intent (raw - with addresses, will be converted to bytes32 in typedData)
    this.logger.log('Step 1: Building burn intent...');
    const maxUint256 =
      '115792089237316195423570985008687907853269984665640564039457584007913129639935';

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

    // 3) build EIP-712 typed data (converts addresses to bytes32)
    const typedData = this.buildBurnIntentTypedData(rawBurnIntent);

    // 4) sign typed data via Circle SDK
    this.logger.log('Step 2: Signing burn intent (EIP-712)...');
    const sigResp = await this.circleDeveloperSdk.signTypedData({
      walletId: sourceWalletId,
      data: JSON.stringify(typedData),
    });

    const userSignature = sigResp.data?.signature;
    if (!userSignature) throw new Error('signTypedData failed (no signature)');

    // 5) submit to Gateway API to obtain attestation + operator signature
    this.logger.log('Step 3: Submitting to Circle Gateway API /transfer...');
    const attResp = await this.createTransferAttestation(typedData.message, userSignature);

    this.logger.log(`Attestation received (transferId=${attResp.transferId})`);

    // 6) mint on Arc (GatewayMinter.gatewayMint(bytes attestation, bytes operatorSignature))
    this.logger.log('Step 4: Minting on Arc (GatewayMinter.gatewayMint)...');
    const mintTx = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId: destinationWalletId,
      contractAddress: this.gatewayMinterAddress,
      abiFunctionSignature: 'gatewayMint(bytes,bytes)',
      abiParameters: [attResp.attestation, attResp.signature],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const mintTxId = mintTx.data?.id;
    if (!mintTxId) throw new Error('Failed to create mint transaction');

    await this.waitForTxCompletion(mintTxId, 'Gateway mint (Arc)');

    this.logger.log('✅ Cross-chain transfer completed successfully!');

    return {
      attestation: attResp.attestation,
      operatorSignature: attResp.signature,
      mintTxId,
      transferId: attResp.transferId,
    };
  }

  // ----------------------------------------------------------------------------
  // Unified balance query (Circle Gateway /balances)
  // ----------------------------------------------------------------------------

  async getUnifiedUSDCBalance(
    depositorAddress: string,
    chains?: WalletChain[],
  ): Promise<{
    totalBalanceE6: string;
    totalBalanceUSDC: string;
    balancesByChain: Array<{
      chain: WalletChain;
      domain: number;
      balanceE6: string;
      balanceUSDC: string;
    }>;
  }> {
    this.logger.log(`Querying unified USDC balance for ${depositorAddress}`);

    const chainsToQuery = chains ?? (Object.keys(this.chainDomains) as WalletChain[]);
    const sources = chainsToQuery.map((chain) => ({
      domain: this.chainDomains[chain].domain,
      depositor: depositorAddress,
    }));

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.gatewayBalanceApiUrl,
          { token: 'USDC', sources },
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const { balances = [] } = response.data ?? {};

      let totalBalanceE6 = 0n;
      const balancesByChain: Array<{
        chain: WalletChain;
        domain: number;
        balanceE6: string;
        balanceUSDC: string;
      }> = [];

      for (const b of balances) {
        const amountE6 = this.toBigInt(b?.balance);
        const domain = Number(b?.domain);

        const chainEntry = (Object.entries(this.chainDomains) as Array<[WalletChain, any]>).find(
          ([, info]) => info.domain === domain,
        );
        const chain = (chainEntry?.[0] ?? `ARC-TESTNET`) as WalletChain; // fallback

        const amountUSDC = Number(amountE6) / 1_000_000;

        balancesByChain.push({
          chain,
          domain,
          balanceE6: amountE6.toString(),
          balanceUSDC: amountUSDC.toFixed(6),
        });

        totalBalanceE6 += amountE6;
      }

      const totalBalanceUSDC = (Number(totalBalanceE6) / 1_000_000).toFixed(6);

      return {
        totalBalanceE6: totalBalanceE6.toString(),
        totalBalanceUSDC,
        balancesByChain,
      };
    } catch (error: any) {
      this.logger.error('Failed to query unified USDC balance', error.response?.data || error.message);
      throw error;
    }
  }

  private toBigInt(value: string | number | null | undefined): bigint {
    const s = String(value ?? '0');
    if (s.includes('.')) {
      const [whole, decimal = ''] = s.split('.');
      const decimal6 = (decimal + '000000').slice(0, 6);
      return BigInt((whole || '0') + decimal6);
    }
    return BigInt(s || '0');
  }

  // ----------------------------------------------------------------------------
  // Helpers: addresses + high-level aggregation to Arc
  // ----------------------------------------------------------------------------

  getUSDCAddress(chain: WalletChain): string {
    const addr = this.usdcAddresses[chain];
    if (!addr) throw new Error(`USDC address not configured for chain: ${chain}`);
    return addr;
  }

  /**
   * Aggregate USDC from multiple source chains to Arc
   * NOTE: You must deposit USDC to Gateway Wallet first for each chain
   * 
   * For each source chain with sufficient balance:
   * 1. Query unified balance
   * 2. Create burn intent and get attestation
   * 3. Mint on Arc
   */
  async aggregateUSDCToArc(params: {
    depositorAddress: string; // same depositor across domains (typically same EOA)
    sourceWalletIds: Partial<Record<WalletChain, string>>; // walletId per chain
    destinationWalletId: string; // Arc walletId (minter caller)
    recipientAddress: string; // final recipient on Arc
    minAmountPerChain?: number; // default 0.01
    maxFee?: string; // default 2.01 USDC
  }): Promise<{
    totalTransferred: string;
    transfers: Array<{
      sourceChain: WalletChain;
      amount: number;
      transferId?: string;
      attestation?: string;
      mintTxId?: string;
      status: 'success' | 'skipped' | 'failed';
      error?: string;
    }>;
  }> {
    const {
      depositorAddress,
      sourceWalletIds,
      destinationWalletId,
      recipientAddress,
      minAmountPerChain = 0.01,
      maxFee = '2010000',
    } = params;

    this.logger.log('=== Multi-Chain USDC Aggregation -> ARC-TESTNET ===');
    this.logger.log(`Depositor: ${depositorAddress}`);
    this.logger.log(`Destination walletId (Arc): ${destinationWalletId}`);
    this.logger.log(`Recipient (Arc): ${recipientAddress}`);

    // only take supported source chains (exclude ARC itself)
    const allChains = Object.keys(sourceWalletIds) as WalletChain[];
    const sourceChains = allChains.filter((c) => c !== 'ARC-TESTNET') as WalletChain[];

    // query balances for those chains
    const balances = await this.getUnifiedUSDCBalance(depositorAddress, sourceChains);

    const transfers: Array<{
      sourceChain: WalletChain;
      amount: number;
      transferId?: string;
      attestation?: string;
      mintTxId?: string;
      status: 'success' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    let totalTransferred = 0;

    for (const chainBal of balances.balancesByChain) {
      const sourceChain = chainBal.chain;
      const sourceWalletId = sourceWalletIds[sourceChain];
      const availableAmount = parseFloat(chainBal.balanceUSDC);

      this.logger.log(`\n--- ${sourceChain} ---`);
      this.logger.log(`Available: ${availableAmount} USDC`);
      this.logger.log(`walletId: ${sourceWalletId ?? '(missing)'}`);

      if (!sourceWalletId) {
        transfers.push({
          sourceChain,
          amount: 0,
          status: 'skipped',
          error: 'No walletId configured for this chain',
        });
        continue;
      }

      if (availableAmount < minAmountPerChain) {
        transfers.push({
          sourceChain,
          amount: availableAmount,
          status: 'skipped',
          error: `Balance too low (< ${minAmountPerChain})`,
        });
        continue;
      }

      // leave a tiny buffer
      const amountToTransfer = Math.max(0, availableAmount - 0.001);

      try {
        const res = await this.crossChainTransferToArc({
          sourceWalletId,
          sourceDomain: chainBal.domain,
          sourceUsdcAddress: this.getUSDCAddress(sourceChain),
          destinationWalletId,
          recipientAddress,
          amount: amountToTransfer,
          maxFee,
        });

        transfers.push({
          sourceChain,
          amount: amountToTransfer,
          transferId: res.transferId,
          attestation: res.attestation,
          mintTxId: res.mintTxId,
          status: 'success',
        });

        totalTransferred += amountToTransfer;
        this.logger.log(`✅ Success: ${amountToTransfer.toFixed(6)} USDC`);
      } catch (error: any) {
        transfers.push({
          sourceChain,
          amount: amountToTransfer,
          status: 'failed',
          error: error?.message ?? String(error),
        });
        this.logger.error(`❌ Failed on ${sourceChain}:`, error?.message ?? error);
      }
    }

    return {
      totalTransferred: totalTransferred.toFixed(6),
      transfers,
    };
  }

  /**
   * Single-chain transfer -> Arc
   */
  async transferToArc(params: {
    sourceChain: Exclude<WalletChain, 'ARC-TESTNET'>;
    sourceWalletId: string;
    destinationWalletId: string; // Arc
    recipientAddress: string; // Arc
    amount: number;
    maxFee?: string;
  }) {
    const { sourceChain, sourceWalletId, destinationWalletId, recipientAddress, amount, maxFee } =
      params;

    return this.crossChainTransferToArc({
      sourceWalletId,
      sourceDomain: this.chainDomains[sourceChain].domain,
      sourceUsdcAddress: this.getUSDCAddress(sourceChain),
      destinationWalletId,
      recipientAddress,
      amount,
      maxFee,
    });
  }
}
