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
  private readonly gatewayBalanceApiUrl = 'https://gateway-api-testnet.circle.com/v1/balances';
  
  // Chain domain mapping for Circle Gateway
  private readonly chainDomains = {
    'ETH-SEPOLIA': { domain: 0, name: 'Ethereum Sepolia' },
    'AVAX-FUJI': { domain: 1, name: 'Avalanche Fuji' },
    'BASE-SEPOLIA': { domain: 6, name: 'Base Sepolia' },
    'ARC-TESTNET': { domain: 26, name: 'Arc Testnet' },
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

  /**
   * Query unified USDC balance across multiple chains using Circle Gateway API
   * @param depositorAddress - The wallet address to query
   * @param chains - Optional list of chains to query (defaults to all supported chains)
   * @returns Unified balance information
   */
  async getUnifiedUSDCBalance(
    depositorAddress: string,
    chains?: string[],
  ): Promise<{
    totalBalanceE6: string;
    totalBalanceUSDC: string;
    balancesByChain: Array<{
      chain: string;
      domain: number;
      balanceE6: string;
      balanceUSDC: string;
    }>;
  }> {
    this.logger.log(`Querying unified USDC balance for ${depositorAddress}`);
    
    // Determine which chains to query
    const chainsToQuery = chains || Object.keys(this.chainDomains);
    const sources = chainsToQuery.map(chain => {
      const chainInfo = this.chainDomains[chain as keyof typeof this.chainDomains];
      if (!chainInfo) {
        throw new Error(`Unsupported chain: ${chain}`);
      }
      return {
        domain: chainInfo.domain,
        depositor: depositorAddress,
      };
    });
    
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.gatewayBalanceApiUrl,
          {
            token: 'USDC',
            sources,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      
      const { balances = [] } = response.data;
      
      let totalBalanceE6 = 0n;
      const balancesByChain: Array<{
        chain: string;
        domain: number;
        balanceE6: string;
        balanceUSDC: string;
      }> = [];
      
      for (const balance of balances) {
        const amountE6 = this.toBigInt(balance?.balance);
        const domain = balance?.domain as number;
        
        // Find chain name by domain
        const chainEntry = Object.entries(this.chainDomains).find(
          ([, info]) => info.domain === domain,
        );
        const chainName = chainEntry?.[0] || `Domain-${domain}`;
        
        const amountUSDC = Number(amountE6) / 1_000_000;
        
        balancesByChain.push({
          chain: chainName,
          domain,
          balanceE6: amountE6.toString(),
          balanceUSDC: amountUSDC.toFixed(6),
        });
        
        totalBalanceE6 += amountE6;
        
        this.logger.log(
          `  - ${chainName}: ${amountUSDC.toFixed(6)} USDC`,
        );
      }
      
      const totalBalanceUSDC = (Number(totalBalanceE6) / 1_000_000).toFixed(6);
      this.logger.log(`Unified USDC balance: ${totalBalanceUSDC} USDC`);
      
      return {
        totalBalanceE6: totalBalanceE6.toString(),
        totalBalanceUSDC,
        balancesByChain,
      };
    } catch (error) {
      this.logger.error(
        'Failed to query unified USDC balance',
        error.response?.data || error.message,
      );
      throw error;
    }
  }
  
  /**
   * Convert string/number to BigInt (handles decimal values)
   */
  private toBigInt(value: string | number | null | undefined): bigint {
    const balanceString = String(value ?? '0');
    if (balanceString.includes('.')) {
      const [whole, decimal = ''] = balanceString.split('.');
      const decimal6 = (decimal + '000000').slice(0, 6);
      return BigInt((whole || '0') + decimal6);
    }
    return BigInt(balanceString || '0');
  }

  /**
   * Get USDC contract address for a specific chain
   */
  getUSDCAddress(chain: WalletChain): string {
    const usdcAddresses = {
      'ETH-SEPOLIA': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      'BASE-SEPOLIA': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      'AVAX-FUJI': '0x5425890298aed601595a70AB815c96711a31Bc65',
      'ARC-TESTNET': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Assuming ARC testnet USDC address
    };
    return usdcAddresses[chain];
  }

  /**
   * Aggregate USDC from multiple source chains to ARC-TESTNET
   * Automatically queries balances and transfers available USDC from each chain
   * 
   * @param depositorAddress - The wallet address (same across all chains for EOA)
   * @param sourceWalletIds - Map of chain to walletId (e.g., { 'ETH-SEPOLIA': 'wallet-id-1', 'BASE-SEPOLIA': 'wallet-id-2' })
   * @param destinationWalletId - ARC-TESTNET wallet ID
   * @param recipientAddress - Final recipient address on ARC-TESTNET
   * @param minAmountPerChain - Minimum USDC amount to transfer from each chain (default: 0.01)
   * @param maxFee - Maximum fee per transfer (default: "2010000" = 2.01 USDC)
   * @returns Array of transfer results for each chain
   */
  async aggregateUSDCToArc(params: {
    depositorAddress: string;
    sourceWalletIds: { [chain in WalletChain]?: string };
    destinationWalletId: string;
    recipientAddress: string;
    minAmountPerChain?: number;
    maxFee?: string;
  }): Promise<{
    totalTransferred: string;
    transfers: Array<{
      sourceChain: string;
      amount: number;
      attestation: string;
      mintTxId: string;
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

    this.logger.log('=== Starting Multi-Chain USDC Aggregation to ARC-TESTNET ===');
    this.logger.log(`Depositor: ${depositorAddress}`);
    this.logger.log(`Destination Wallet ID: ${destinationWalletId}`);
    this.logger.log(`Recipient: ${recipientAddress}`);
    this.logger.log(`Min Amount Per Chain: ${minAmountPerChain} USDC`);

    // Step 1: Query balances on all source chains (only Gateway-supported chains)
    const supportedChains = Object.keys(this.chainDomains);
    const allSourceChains = Object.keys(sourceWalletIds).filter(
      chain => chain !== 'ARC-TESTNET'
    );
    const sourceChains = allSourceChains.filter(
      chain => supportedChains.includes(chain)
    ) as WalletChain[];

    // Log unsupported chains if any
    const unsupportedChains = allSourceChains.filter(
      chain => !supportedChains.includes(chain)
    );
    if (unsupportedChains.length > 0) {
      this.logger.warn(
        `Skipping unsupported chains (Gateway only supports ${supportedChains.join(', ')}): ${unsupportedChains.join(', ')}`
      );
    }

    this.logger.log(`\nStep 1: Querying balances on ${sourceChains.length} Gateway-supported chains...`);
    const balances = await this.getUnifiedUSDCBalance(depositorAddress, sourceChains);

    // Step 2: Process transfers from each chain
    const transfers: Array<{
      sourceChain: string;
      amount: number;
      attestation: string;
      mintTxId: string;
      status: 'success' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    let totalTransferred = 0;

    this.logger.log('\nStep 2: Processing transfers...');
    for (const chainBalance of balances.balancesByChain) {
      const sourceChain = chainBalance.chain as WalletChain;
      const sourceWalletId = sourceWalletIds[sourceChain];
      const availableAmount = parseFloat(chainBalance.balanceUSDC);

      this.logger.log(`\n--- ${sourceChain} ---`);
      this.logger.log(`Available: ${availableAmount} USDC`);
      this.logger.log(`Wallet ID: ${sourceWalletId}`);

      // Skip if no wallet ID configured
      if (!sourceWalletId) {
        this.logger.warn(`No wallet ID configured for ${sourceChain}, skipping`);
        transfers.push({
          sourceChain,
          amount: 0,
          attestation: '',
          mintTxId: '',
          status: 'skipped',
          error: 'No wallet ID configured',
        });
        continue;
      }

      // Skip if balance too low
      if (availableAmount < minAmountPerChain) {
        this.logger.warn(
          `Balance too low on ${sourceChain} (${availableAmount} < ${minAmountPerChain}), skipping`
        );
        transfers.push({
          sourceChain,
          amount: availableAmount,
          attestation: '',
          mintTxId: '',
          status: 'skipped',
          error: `Balance too low (${availableAmount} < ${minAmountPerChain})`,
        });
        continue;
      }

      // Calculate amount to transfer (leave small buffer for fees)
      const amountToTransfer = Math.max(0, availableAmount - 0.001);
      
      this.logger.log(`Transferring: ${amountToTransfer} USDC`);

      try {
        // Execute cross-chain transfer
        const result = await this.crossChainTransfer({
          sourceWalletId,
          sourceDomain: chainBalance.domain,
          sourceUsdcAddress: this.getUSDCAddress(sourceChain),
          destinationWalletId,
          destinationDomain: this.chainDomains['ARC-TESTNET'].domain,
          destinationUsdcAddress: this.getUSDCAddress('ARC-TESTNET'),
          destinationBlockchain: 'ARC-TESTNET',
          recipientAddress,
          amount: amountToTransfer,
          maxFee,
        });

        transfers.push({
          sourceChain,
          amount: amountToTransfer,
          attestation: result.attestation,
          mintTxId: result.mintTxId,
          status: 'success',
        });

        totalTransferred += amountToTransfer;
        this.logger.log(`✅ Success: ${amountToTransfer} USDC transferred`);
      } catch (error) {
        this.logger.error(`❌ Failed to transfer from ${sourceChain}:`, error.message);
        transfers.push({
          sourceChain,
          amount: amountToTransfer,
          attestation: '',
          mintTxId: '',
          status: 'failed',
          error: error.message,
        });
      }
    }

    this.logger.log('\n=== Aggregation Complete ===');
    this.logger.log(`Total Transferred: ${totalTransferred.toFixed(6)} USDC`);
    this.logger.log(
      `Success: ${transfers.filter(t => t.status === 'success').length}/${transfers.length}`
    );

    return {
      totalTransferred: totalTransferred.toFixed(6),
      transfers,
    };
  }

  /**
   * Transfer USDC from a single source chain to ARC-TESTNET
   * Simplified wrapper for single-chain to ARC transfer
   */
  async transferToArc(params: {
    sourceChain: WalletChain;
    sourceWalletId: string;
    destinationWalletId: string;
    recipientAddress: string;
    amount: number;
    maxFee?: string;
  }): Promise<{ attestation: string; mintTxId: string }> {
    const {
      sourceChain,
      sourceWalletId,
      destinationWalletId,
      recipientAddress,
      amount,
      maxFee = '2010000',
    } = params;

    if (sourceChain === 'ARC-TESTNET') {
      throw new Error('Cannot transfer to ARC-TESTNET from ARC-TESTNET');
    }

    // Check if source chain is supported by Gateway
    const supportedChains = Object.keys(this.chainDomains);
    if (!supportedChains.includes(sourceChain)) {
      throw new Error(
        `Unsupported source chain: ${sourceChain}. Gateway supports: ${supportedChains.join(', ')}`
      );
    }

    this.logger.log(`Transferring ${amount} USDC from ${sourceChain} to ARC-TESTNET`);

    const sourceChainInfo = this.chainDomains[sourceChain];
    const destChainInfo = this.chainDomains['ARC-TESTNET'];

    return this.crossChainTransfer({
      sourceWalletId,
      sourceDomain: sourceChainInfo.domain,
      sourceUsdcAddress: this.getUSDCAddress(sourceChain),
      destinationWalletId,
      destinationDomain: destChainInfo.domain,
      destinationUsdcAddress: this.getUSDCAddress('ARC-TESTNET'),
      destinationBlockchain: 'ARC-TESTNET',
      recipientAddress,
      amount,
      maxFee,
    });
  }
}
