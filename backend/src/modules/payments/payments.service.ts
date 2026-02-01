import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CircleWalletService } from '../circle/circle-wallet.service';
import { CircleGatewayService } from '../circle/circle-gateway.service';
import { ArcContractService } from '../chain/arc-contract.service';
import { UsersService } from '../users/users.service';
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

    // Get or create user wallet
    const userWallet = await this.usersService.getOrCreateWallet(dto.userId);
    const arcAddress = userWallet.addresses['ARB-SEPOLIA'];

    if (!arcAddress) {
      throw new BadRequestException('User does not have an Arc address');
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
    this.logger.log(`Payment intent: ${paymentIntent.id}`);
    this.logger.log(`Waiting for deposit confirmation...`);

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
   * 1. Verify user has sufficient USDC on Arc
   * 2. Approve USDC to Ledger contract
   * 3. Call subscribe on Ledger contract
   */
  async subscribe(dto: SubscribeDto) {
    this.logger.log(`User ${dto.userId} subscribing to product ${dto.productId}`);

    // Get user wallet
    const userWallet = await this.usersService.getUserWallet(dto.userId);
    const arcAddress = userWallet.addresses['ARB-SEPOLIA'];

    if (!arcAddress) {
      throw new BadRequestException('User does not have an Arc address');
    }

    // Check USDC balance
    const balance = await this.arcContractService.getUSDCBalance(arcAddress);
    if (BigInt(balance) < BigInt(dto.amountE6)) {
      throw new BadRequestException('Insufficient USDC balance');
    }

    // In production:
    // 1. Create approve transaction (user signs via Circle Wallet)
    // 2. Wait for approval confirmation
    // 3. Create subscribe transaction
    // 4. Wait for subscribe confirmation
    // 5. Return transaction details

    this.logger.log(`Subscription initiated for product ${dto.productId}`);
    
    return {
      success: true,
      message: 'Subscription transaction created',
      productId: dto.productId,
      amount: dto.amountE6,
      // In production, return actual transaction hashes
      approveTxHash: '0x...',
      subscribeTxHash: '0x...',
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

    // Get user wallet
    const userWallet = await this.usersService.getUserWallet(userId);
    const arcAddress = userWallet.addresses['ARB-SEPOLIA'];

    // Check pending dividend
    const pending = await this.arcContractService.getPendingDividend(productId, arcAddress);

    if (pending === '0') {
      throw new BadRequestException('No pending dividend to claim');
    }

    // In production:
    // 1. Create claim transaction
    // 2. Wait for confirmation

    return {
      success: true,
      message: 'Dividend claimed',
      productId,
      amountClaimed: pending,
      txHash: '0x...',
    };
  }
}
