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
    
    // Convert amount to base units (6 decimals)
    const amountE6 = (dto.amount * 1_000_000).toString();

    this.logger.log(`Source: ${dto.sourceChain} (${sourceWallet.address})`);
    this.logger.log(`USDC: ${usdcAddress}`);
    this.logger.log(`Amount: ${amountE6} (${dto.amount} USDC)`);

    // Execute deposit (approve + deposit)
    const result = await this.circleGatewayService.completeGatewayDeposit(
      sourceWallet.walletId,
      usdcAddress,
      amountE6,
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

    this.logger.log(`Source: ${dto.sourceChain} (${sourceWallet.address})`);
    this.logger.log(`Destination: ARC-TESTNET (${arcWallet.address})`);
    this.logger.log(`Amount: ${dto.amount} USDC`);

    // Execute transfer
    const result = await this.circleGatewayService.transferToArc({
      sourceChain: dto.sourceChain as Exclude<WalletChain, 'ARC-TESTNET'>,
      sourceWalletId: sourceWallet.walletId,
      destinationWalletId: arcWallet.walletId,
      recipientAddress: arcWallet.address,
      amount: dto.amount,
      maxFee: dto.maxFee,
    });

    return {
      success: true,
      message: `Transferred ${dto.amount} USDC from ${dto.sourceChain} to ARC-TESTNET`,
      userId: dto.userId,
      sourceChain: dto.sourceChain,
      destinationChain: 'ARC-TESTNET',
      amount: dto.amount,
      sourceAddress: sourceWallet.address,
      destinationAddress: arcWallet.address,
      attestation: result.attestation,
      mintTxId: result.mintTxId,
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
    //    先查 allowance，足夠就跳過 approve（MVP 非常值得做，少一筆 tx = 少一個失敗點）
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
    //    ✅ 建議直接用 actualAmountE6 呼叫 subscribe（避免「非整數倍」帶來 debug 困擾）
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
