import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';
import { CircleGatewayService } from '../circle/circle-gateway.service';
import { ArcContractService } from '../chain/arc-contract.service';
import { UsersService, WalletRole } from '../users/users.service';
import { FundArcDto, SubscribeDto } from './dto/payment.dto';

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
    //    先查 allowance，足夠就跳過 approve（MVP 非常值得做，少一筆 tx = 少一個失敗點）
    const allowanceE6 = BigInt(
      await this.arcContractService.getUSDCAllowance(arcAddress),
    );

    let approveTxId: string | null = null;
    let approveTxHash: string | null = null;
    if (allowanceE6 < actualAmountE6) {
      this.logger.log(
        `Allowance too low: allowance=${allowanceE6.toString()} need=${actualAmountE6.toString()} => approving...`,
      );
      const approveRes = await this.arcContractService.approveUSDC(
        userWallet.walletId,
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
    //    ✅ 建議直接用 actualAmountE6 呼叫 subscribe（避免「非整數倍」帶來 debug 困擾）
    const subscribeRes = await this.arcContractService.subscribe(
      userWallet.walletId,
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
   */
  async declareDividend(productId: number, amountE6: string, issuerAddress: string) {
    this.logger.log(`Declaring dividend for product ${productId}: ${amountE6}`);

    // In production:
    // 1. Verify caller is the issuer
    // 2. Create approve USDC transaction
    // 3. Create declareDividend transaction
    // 4. Wait for confirmation

    return {
      success: true,
      message: 'Dividend declared',
      productId,
      amountE6,
      txHash: '0x...',
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
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');

    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }

    // Check pending dividend
    const pending = await this.arcContractService.getPendingDividend(productId, arcAddress);
    this.logger.log(`Pending dividend for user ${userId}, product ${productId}: ${pending}`);

    if (pending === '0') {
      this.logger.warn(`No pending dividend to claim for user ${userId}, product ${productId}`);
      throw new BadRequestException('No pending dividend to claim');
    }

    // In production:
    // 1. Create claim transaction
    // 2. Wait for confirmation

    this.logger.log(`Dividend claim successful for user ${userId}, product ${productId}, amount: ${pending}`);

    return {
      success: true,
      message: 'Dividend claimed',
      productId,
      amountClaimed: pending,
      txHash: '0x...',
    };
  }
}
