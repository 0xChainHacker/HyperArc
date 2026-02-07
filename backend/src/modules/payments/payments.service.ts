import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';
import { CircleGatewayService, WalletChain } from '../circle/circle-gateway.service';
import { ArcContractService } from '../chain/arc-contract.service';
import { UsersService, WalletRole, ChainWallet } from '../users/users.service';
import { FundArcDto, DepositToGatewayDto, TransferToArcDto, SubscribeDto } from './dto/payment.dto';

export interface GatewayTransaction {
  txId: string;
  userId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  depositTxId?: string;
  withdrawalTxId?: string;
  amount: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  // In production, this would be a database
  private readonly gatewayTransactions = new Map<string, GatewayTransaction>();

  constructor(
    private readonly circleWalletService: CircleWalletService,
    private readonly circleGatewayService: CircleGatewayService,
    private readonly arcContractService: ArcContractService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Fund Arc address via Circle Gateway
   * 1. Create payment intent for source chain deposit
   * 2. Wait for deposit confirmation
   * 3. Withdraw to user's Arc address
   */
  async fundArc(dto: FundArcDto): Promise<GatewayTransaction> {
    this.logger.log(`Funding Arc for user ${dto.userId} from ${dto.sourceChain}`);

    // Get or create investor wallet (investors receive funds)
    const userWallet = await this.usersService.getOrCreateWallet(
      dto.userId,
      WalletRole.INVESTOR,
      ['ARC-TESTNET']
    );
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');

    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }

    // Step 1: Create payment intent for deposit
    const paymentIntent = await this.circleGatewayService.createPaymentIntent(
      dto.userId,
      dto.amount,
      'USD',
      dto.sourceChain,
    );

    // Create gateway transaction record
    const txId = `gateway-${Date.now()}-${dto.userId}`;
    const gatewayTx: GatewayTransaction = {
      txId,
      userId: dto.userId,
      status: 'PENDING',
      depositTxId: paymentIntent.id,
      amount: dto.amount,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.gatewayTransactions.set(txId, gatewayTx);

    this.logger.log(`Gateway transaction created: ${txId}`);
    this.logger.log(`Payment intent created: ${paymentIntent.id}`);
    this.logger.log(`Arc destination address: ${arcAddress}`);
    this.logger.log(`Waiting for deposit confirmation from ${dto.sourceChain}...`);

    // In production:
    // - Poll payment intent status
    // - When confirmed, withdraw USDC to Arc address
    // - Update transaction status

    return gatewayTx;
  }

  /**
   * Get gateway transaction status
   */
  async getGatewayTransaction(txId: string): Promise<GatewayTransaction> {
    const tx = this.gatewayTransactions.get(txId);
    if (!tx) {
      throw new BadRequestException(`Transaction ${txId} not found`);
    }

    // In production, check actual on-chain status
    return tx;
  }

  /**
   * Deposit USDC to Gateway Wallet (Step 1)
   * Approve + Deposit USDC from source chain to Gateway unified balance
   */
  async depositToGateway(dto: DepositToGatewayDto) {
    this.logger.log(
      `Depositing ${dto.amount} USDC from ${dto.sourceChain} to Gateway for user ${dto.userId}`
    );

    // Get user wallet
    const userWallet = await this.usersService.getUserWallet(dto.userId, WalletRole.INVESTOR);

    // Get source chain wallet
    const sourceWallet = userWallet.circleWallet[dto.sourceChain];
    if (!sourceWallet) {
      throw new BadRequestException(
        `User does not have a wallet on ${dto.sourceChain}. Please add blockchain first.`
      );
    }

    // Get USDC address for source chain
    const usdcAddress = this.circleGatewayService.getUSDCAddress(dto.sourceChain as any);

    // Keep decimal string for Circle SDK (expects decimal like "10") and also compute base units for reporting
    const amountStr = String(dto.amount);
    const amountE6 = (dto.amount * 1_000_000).toString();

    this.logger.log(`Source: ${dto.sourceChain} (${sourceWallet.address})`);
    this.logger.log(`USDC: ${usdcAddress}`);
    this.logger.log(`Amount: ${amountE6} (${dto.amount} USDC)`);

    // Execute deposit (approve + deposit)
    const result = await this.circleGatewayService.completeGatewayDeposit(
      sourceWallet.walletId,
      usdcAddress,
      amountStr,
    );

    return {
      success: true,
      message: `Deposited ${dto.amount} USDC from ${dto.sourceChain} to Gateway Wallet`,
      userId: dto.userId,
      sourceChain: dto.sourceChain,
      sourceAddress: sourceWallet.address,
      amount: dto.amount,
      amountE6,
      ...result,
    };
  }

  /**
   * Transfer USDC from a specific source chain to ARC-TESTNET (Step 2)
   */
  async transferToArc(dto: TransferToArcDto) {
    this.logger.log(
      `Transferring ${dto.amount} USDC from ${dto.sourceChain} to ARC for user ${dto.userId}`
    );

    // Get user wallet
    const userWallet = await this.usersService.getUserWallet(dto.userId, WalletRole.INVESTOR);

    // Get source chain wallet
    const sourceWallet = userWallet.circleWallet[dto.sourceChain];
    if (!sourceWallet) {
      throw new BadRequestException(
        `User does not have ${dto.sourceChain} wallet. Available chains: ${Object.keys(userWallet.circleWallet).join(', ')}`
      );
    }

    // Get ARC wallet
    const arcWallet = userWallet.circleWallet['ARC-TESTNET'];
    if (!arcWallet) {
      throw new BadRequestException(
        'User does not have ARC-TESTNET wallet. Please add ARC-TESTNET blockchain first.'
      );
    }

    this.logger.log(`Requested source: ${dto.sourceChain ?? 'AUTO'}`);
    this.logger.log(`Destination: ARC-TESTNET (${arcWallet.address})`);
    this.logger.log(`Amount: ${dto.amount} USDC`);

    // Determine search order. If caller provided a sourceChain, try it first,
    // then fall back to preferred order. Preferred order: BASE -> AVAX -> ETH
    const preferredOrder: WalletChain[] = [
      WalletChain.ARC_TESTNET,
      WalletChain.BASE_SEPOLIA,
      WalletChain.AVAX_FUJI,
      WalletChain.ETH_SEPOLIA,
    ];
    const searchOrder: WalletChain[] = [];
    if (dto.sourceChain) {
      // if provided and valid, start with normalized provided chain
      const provided = dto.sourceChain as WalletChain;
      searchOrder.push(provided);
      for (const c of preferredOrder) if (c !== provided) searchOrder.push(c);
    } else {
      searchOrder.push(...preferredOrder);
    }

    // Query unified balances for searchOrder
    const unified = await this.usersService.getUnifiedUSDCBalance(dto.userId, WalletRole.INVESTOR, searchOrder as any);
    const balanceMap: Record<string, number> = {};
    for (const b of unified.balancesByChain || []) {
      balanceMap[b.chain] = parseFloat(b.balanceUSDC);
    }

    // Build sourceWalletIds from user wallet
    const sourceWalletIds: Partial<Record<WalletChain, string>> = {};
    for (const c of searchOrder) {
      const cw = userWallet.circleWallet[c as string];
      if (cw) sourceWalletIds[c] = cw.walletId;
    }

    // Default maxFee per chain (micro USDC, 6 decimals)
    const defaultMaxFeeByChain: Partial<Record<WalletChain, string>> = {
      [WalletChain.ARC_TESTNET]: '20149', // 0.020149 USDC (default for Arc)
      [WalletChain.AVAX_FUJI]: '20149', // 0.020149 USDC
      [WalletChain.BASE_SEPOLIA]: '10247', // 0.010247 USDC
      [WalletChain.ETH_SEPOLIA]: '2000325', // 2.000325 USDC
    };

    const transfers: Array<any> = [];
    let remaining = Number(dto.amount);
    const buffer = 0.001; // leave tiny buffer per chain

    for (const chain of searchOrder) {
      if (remaining <= 1e-9) break;
      const available = balanceMap[chain] ?? 0;
      const walletId = sourceWalletIds[chain];
      if (!walletId) {
        this.logger.log(`Skipping ${chain}: no walletId configured for user`);
        continue;
      }
      if (available <= buffer) {
        this.logger.log(`Skipping ${chain}: available ${available} <= buffer ${buffer}`);
        continue;
      }

      const canUse = Math.max(0, available - buffer);
      let take = Math.min(canUse, remaining);
      if (take <= 0) continue;

      // Work in micro-units to avoid fractional rounding issues
      const availableMicros = Math.floor(available * 1_000_000);
      let amountMicros = Math.floor(take * 1_000_000);

      // helper to normalize maxFee input (accepts micros string or decimal string)
      const parseFeeToMicros = (fee?: string) => {
        if (!fee) return undefined;
        if (fee.includes('.')) {
          const f = parseFloat(fee);
          if (Number.isNaN(f)) return undefined;
          return Math.ceil(f * 1_000_000);
        }
        const n = parseInt(fee, 10);
        return Number.isNaN(n) ? undefined : n;
      };

      // choose maxFee: prefer caller provided, otherwise per-chain default
      const providedMaxFeeMicros = parseFeeToMicros(dto.maxFee as any);
      const defaultMaxFeeMicros = defaultMaxFeeByChain[chain] ? parseInt(defaultMaxFeeByChain[chain]!, 10) : undefined;
      let maxFeeMicros = providedMaxFeeMicros ?? defaultMaxFeeMicros ?? 2010000;

      // ensure amount + fee fits into available; if not, reduce amount
      if (amountMicros + maxFeeMicros > availableMicros) {
        amountMicros = Math.max(0, availableMicros - maxFeeMicros);
        if (amountMicros <= 0) {
          this.logger.log(`Skipping ${chain}: not enough available to cover fee ${maxFeeMicros} micros`);
          continue;
        }
        take = amountMicros / 1_000_000;
        this.logger.log(`Adjusted transfer from ${chain} to ${take} USDC to account for fee`);
      }

      this.logger.log(`Attempting transfer from ${chain}: taking ${take} USDC (available ${available})`);
      try {
        const res = await this.circleGatewayService.transferToArc({
          sourceChain: chain as Exclude<WalletChain, 'ARC-TESTNET'>,
          sourceWalletId: walletId,
          destinationWalletId: arcWallet.walletId,
          recipientAddress: arcWallet.address,
          amount: amountMicros / 1_000_000,
          maxFee: String(maxFeeMicros),
        });

        const sent = amountMicros / 1_000_000;
        transfers.push({ sourceChain: chain, amount: sent, transferId: res.transferId, attestation: res.attestation, mintTxId: res.mintTxId, status: 'success' });
        remaining -= sent;
        this.logger.log(`Transferred ${sent} USDC from ${chain}. Remaining: ${remaining} USDC`);
      } catch (err: any) {
        this.logger.error(`Failed transfer from ${chain}:`, err?.message ?? err);

        // If Gateway complains about insufficient max fee, try to parse required fee and retry once
        const msg = err?.response?.data?.message ?? err?.message ?? '';
        const m = String(msg).match(/expected at least ([0-9.]+)/i);
        if (m) {
          const requiredDecimal = parseFloat(m[1]);
          if (!Number.isNaN(requiredDecimal) && requiredDecimal > 0) {
            const requiredMicros = Math.ceil(requiredDecimal * 1_000_000);
            this.logger.log(`Retrying ${chain} transfer with increased maxFee=${requiredMicros} (required ${requiredDecimal} USDC)`);

            // If increasing fee causes amount+fee to exceed available, reduce amount accordingly
            if (amountMicros + requiredMicros > availableMicros) {
              const newAmountMicros = Math.max(0, availableMicros - requiredMicros);
              if (newAmountMicros <= 0) {
                this.logger.error(`After increasing fee, ${chain} has insufficient funds to cover fee + any amount. Skipping.`);
                transfers.push({ sourceChain: chain, amount: take, status: 'failed', error: 'insufficient funds to cover required fee' });
                continue;
              }
              amountMicros = newAmountMicros;
              take = amountMicros / 1_000_000;
              this.logger.log(`Reduced amount for ${chain} to ${take} USDC to fit new fee`);
            }

            try {
              const retryRes = await this.circleGatewayService.transferToArc({
                sourceChain: chain as Exclude<WalletChain, 'ARC-TESTNET'>,
                sourceWalletId: walletId,
                destinationWalletId: arcWallet.walletId,
                recipientAddress: arcWallet.address,
                amount: amountMicros / 1_000_000,
                maxFee: String(requiredMicros),
              });
              const sent = amountMicros / 1_000_000;
              transfers.push({ sourceChain: chain, amount: sent, transferId: retryRes.transferId, attestation: retryRes.attestation, mintTxId: retryRes.mintTxId, status: 'success' });
              remaining -= sent;
              this.logger.log(`Transferred ${sent} USDC from ${chain} after retry. Remaining: ${remaining} USDC`);
              continue;
            } catch (retryErr: any) {
              this.logger.error(`Retry failed for ${chain}:`, retryErr?.message ?? retryErr);
              transfers.push({ sourceChain: chain, amount: take, status: 'failed', error: retryErr?.message ?? String(retryErr) });
              continue;
            }
          }
        }

        // If no retry path found, record failure
        transfers.push({ sourceChain: chain, amount: take, status: 'failed', error: err?.message ?? String(err) });
      }
    }

    const totalTransferred = Number(dto.amount) - remaining;
    if (remaining > 1e-6) {
      throw new BadRequestException(`Insufficient unified USDC across chains. Requested=${dto.amount} Available=${totalTransferred}`);
    }

    return {
      success: true,
      message: `Transferred ${totalTransferred} USDC to ARC-TESTNET using multi-chain sources`,
      userId: dto.userId,
      sourceChain: 'MULTI',
      destinationChain: 'ARC-TESTNET',
      amount: totalTransferred,
      destinationAddress: arcWallet.address,
      transfers,
    };
  }

  /**
   * Subscribe to a product (investment flow)
   * 1) Validate product & price
   * 2) Compute units & actualAmountE6 (integer multiple of price)
   * 3) Check USDC balance on Arc
   * 4) Ensure allowance (approve if needed)
   * 5) Call subscribe on Ledger
   */
  async subscribe(dto: SubscribeDto) {
    this.logger.log(`User ${dto.userId} subscribing to product ${dto.productId}`);

    // 0) Ensure wallet exists & get Arc address
    const userWallet = await this.usersService.getOrCreateWallet(
      dto.userId,
      WalletRole.INVESTOR,
      ['ARC-TESTNET'],
    );
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');
    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.',
      );
    }

    // 1) Fetch product
    const product = await this.arcContractService.getProduct(dto.productId);
    if (!product.active) {
      throw new BadRequestException('Product is not active');
    }

    const priceE6 = BigInt(product.priceE6);
    const requestedAmountE6 = BigInt(dto.amountE6);

    if (requestedAmountE6 <= 0n) {
      throw new BadRequestException('amountE6 must be > 0');
    }
    if (priceE6 <= 0n) {
      throw new BadRequestException('Invalid product price');
    }

    // 2) Compute units + actualAmountE6
    const units = requestedAmountE6 / priceE6;
    if (units <= 0n) {
      throw new BadRequestException(
        `Amount too small. Minimum required: ${product.priceE6} (${Number(product.priceE6) / 1_000_000} USDC)`,
      );
    }
    const actualAmountE6 = units * priceE6;

    this.logger.log(
      `Computed units=${units.toString()} actualAmountE6=${actualAmountE6.toString()} (priceE6=${priceE6.toString()})`,
    );

    // 3) Check balance
    const balanceE6 = BigInt(await this.arcContractService.getUSDCBalance(arcAddress));
    if (balanceE6 < actualAmountE6) {
      throw new BadRequestException(
        `Insufficient USDC. Required=${actualAmountE6.toString()} Available=${balanceE6.toString()}`,
      );
    }

    // 4) Ensure allowance
    const allowanceE6 = BigInt(
      await this.arcContractService.getUSDCAllowance(arcAddress),
    );

    // Get ARC-TESTNET walletId
    const arcWalletId = userWallet.circleWallet['ARC-TESTNET']?.walletId;
    if (!arcWalletId) {
      throw new BadRequestException('Wallet does not have ARC-TESTNET chain configured');
    }

    let approveTxId: string | null = null;
    let approveTxHash: string | null = null;
    if (allowanceE6 < actualAmountE6) {
      this.logger.log(
        `Allowance too low: allowance=${allowanceE6.toString()} need=${actualAmountE6.toString()} => approving...`,
      );
      const approveRes = await this.arcContractService.approveUSDC(
        arcWalletId,
        actualAmountE6.toString(),
      );
      approveTxId = approveRes.txId;
      approveTxHash = approveRes.txHash;
      this.logger.log(`Approve completed: txId=${approveTxId} txHash=${approveTxHash || 'N/A'}`);
    } else {
      this.logger.log(
        `Allowance sufficient: allowance=${allowanceE6.toString()} need=${actualAmountE6.toString()} => skip approve`,
      );
    }

    // 5) Subscribe
    const subscribeRes = await this.arcContractService.subscribe(
      arcWalletId,
      dto.productId,
      actualAmountE6.toString(),
    );

    this.logger.log(`Subscribe completed: txId=${subscribeRes.txId} txHash=${subscribeRes.txHash || 'N/A'}`);

    return {
      success: true,
      message: 'Subscription completed',
      productId: dto.productId,
      investor: arcAddress,
      units: units.toString(),
      amountPaidE6: actualAmountE6.toString(),
      pricePerUnitE6: product.priceE6,
      approveTxId,
      approveTxHash,
      subscribeTxId: subscribeRes.txId,
      subscribeTxHash: subscribeRes.txHash,
    };
  }

  /**
   * Declare dividend (issuer action)
   * 1. Verify issuer
   * 2. Approve USDC to distributor contract
   * 3. Call declareDividend on distributor
   */
  async declareDividend(dto: any) {
    this.logger.log(
      `Declaring dividend for product ${dto.productId}: ${dto.amountE6} by issuer ${dto.issuerUserId}`
    );

    if (!dto.issuerUserId) {
      throw new BadRequestException('issuerUserId is required');
    }

    if (BigInt(dto.amountE6) <= 0n) {
      throw new BadRequestException('amountE6 must be > 0');
    }

    // Get issuer wallet
    const issuerWallet = await this.usersService.getUserWallet(
      dto.issuerUserId,
      WalletRole.ISSUER,
    );
    const issuerAddress = this.usersService.getAddressForBlockchain(
      issuerWallet,
      'ARC-TESTNET'
    );

    if (!issuerAddress) {
      throw new BadRequestException(
        'Issuer does not have an Arc address. Please create issuer wallet with ARC-TESTNET.'
      );
    }

    // Get product to verify issuer
    const product = await this.arcContractService.getProduct(dto.productId);
    if (product.issuer.toLowerCase() !== issuerAddress.toLowerCase()) {
      throw new BadRequestException(
        'Only the product issuer can declare dividends for this product'
      );
    }

    // Check issuer USDC balance
    const balance = await this.arcContractService.getUSDCBalance(issuerAddress);
    if (BigInt(balance) < BigInt(dto.amountE6)) {
      throw new BadRequestException(
        `Insufficient USDC balance. Required: ${dto.amountE6}, Available: ${balance}`
      );
    }

    // Get ARC-TESTNET walletId for issuer
    const arcWalletId = issuerWallet.circleWallet['ARC-TESTNET']?.walletId;
    if (!arcWalletId) {
      throw new BadRequestException('Issuer wallet does not have ARC-TESTNET chain configured');
    }

    // Approve USDC to distributor contract
    const approveRes = await this.arcContractService.approveUSDCForDistributor(
      arcWalletId,
      dto.amountE6,
    );
    this.logger.log(
      `USDC approved to distributor: txId=${approveRes.txId} txHash=${approveRes.txHash || 'N/A'}`
    );

    // Declare dividend
    const declareRes = await this.arcContractService.declareDividend(
      arcWalletId,
      dto.productId,
      dto.amountE6,
    );
    this.logger.log(
      `Dividend declared: txId=${declareRes.txId} txHash=${declareRes.txHash || 'N/A'}`
    );

    return {
      success: true,
      message: 'Dividend declared successfully',
      productId: dto.productId,
      amountE6: dto.amountE6,
      issuer: issuerAddress,
      approveTxId: approveRes.txId,
      approveTxHash: approveRes.txHash,
      declareTxId: declareRes.txId,
      declareTxHash: declareRes.txHash,
    };
  }

  /**
   * Claim dividend (investor action)
   */
  async claimDividend(userId: string, productId: number) {
    this.logger.log(`User ${userId} claiming dividend from product ${productId}`);

    // Get investor wallet (investors claim dividends)
    const userWallet = await this.usersService.getOrCreateWallet(
      userId,
      WalletRole.INVESTOR,
      ['ARC-TESTNET']
    );
    
    // Get ARC-TESTNET wallet info
    const arcWallet = userWallet.circleWallet['ARC-TESTNET'];
    if (!arcWallet) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }
    const arcAddress = arcWallet.address;
    const arcWalletId = arcWallet.walletId;

    // Check pending dividend
    const pending = await this.arcContractService.getPendingDividend(productId, arcAddress);
    this.logger.log(`Pending dividend for user ${userId}, product ${productId}: ${pending}`);

    if (pending === '0') {
      this.logger.warn(`No pending dividend to claim for user ${userId}, product ${productId}`);
      throw new BadRequestException('No pending dividend to claim');
    }

    // Claim dividend via blockchain transaction
    const claimRes = await this.arcContractService.claimDividend(
      arcWalletId,
      productId,
    );

    this.logger.log(
      `Dividend claimed successfully: txId=${claimRes.txId} txHash=${claimRes.txHash || 'N/A'}`
    );

    return {
      success: true,
      message: 'Dividend claimed successfully',
      userId,
      productId,
      investor: arcAddress,
      amountClaimedE6: pending,
      claimTxId: claimRes.txId,
      claimTxHash: claimRes.txHash,
    };
  }
}
