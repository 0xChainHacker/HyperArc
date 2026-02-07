import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import LedgerABI from './abi/EconomicInterestLedger.json';
import DistributorABI from './abi/DividendDistributor.json';
import USDCABI from './abi/USDC.json';

@Injectable()
export class ArcContractService {
  private readonly logger = new Logger(ArcContractService.name);
  private readonly provider: ethers.JsonRpcProvider;
  private readonly ledgerContract: ethers.Contract;
  private readonly distributorContract: ethers.Contract;
  private readonly usdcContract: ethers.Contract;
  private readonly circleDeveloperSdk: ReturnType<typeof initiateDeveloperControlledWalletsClient>;
  private readonly ledgerAddress: string;
  private readonly distributorAddress: string;
  private readonly usdcAddress: string;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('arc.rpcUrl');
    this.ledgerAddress = this.configService.get<string>('arc.ledgerAddress');
    this.distributorAddress = this.configService.get<string>('arc.distributorAddress');
    this.usdcAddress = this.configService.get<string>('arc.usdcAddress');

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.ledgerContract = new ethers.Contract(this.ledgerAddress, LedgerABI as any, this.provider);
    this.distributorContract = new ethers.Contract(this.distributorAddress, DistributorABI as any, this.provider);
    this.usdcContract = new ethers.Contract(this.usdcAddress, USDCABI as any, this.provider);
    
    // Initialize Circle SDK for contract execution
    const apiKey = this.configService.get<string>('circle.apiKey');
    const entitySecret = this.configService.get<string>('circle.entitySecret');
    this.circleDeveloperSdk = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret,
    });
  }

  /**
   * Create a new product on-chain using Circle Wallet
   * @param walletId - Circle wallet ID to use for signing
   * @param issuer - Issuer address
   * @param priceE6 - Price in USDC (6 decimals)
   * @param metadataURI - Metadata URI (IPFS or other)
   */
  async createProduct(
    walletId: string,
    issuer: string,
    priceE6: string,
    metadataURI: string,
  ): Promise<{ txId: string; productId?: number }> {
    this.logger.log(
      `Creating product on-chain: issuer=${issuer}, price=${priceE6}, metadata=${metadataURI}`
    );

    try {
      // Call createProduct on the ledger contract
      const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
        walletId,
        contractAddress: this.ledgerAddress,
        abiFunctionSignature: 'createProduct(address,uint256,string)',
        abiParameters: [issuer, priceE6, metadataURI],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });

      const txId = response.data?.id;
      if (!txId) {
        throw new Error('Failed to create contract execution transaction');
      }

      this.logger.log(`Product creation transaction created: ${txId}`);

      // Wait for transaction to complete to get the product ID from event
      await this.waitForCircleTransaction(txId);

      // Get the next product ID (the one that was just created)
      const nextId = await this.getNextProductId();
      const productId = nextId > 1 ? nextId - 1 : 1;

      this.logger.log(`Product created with ID: ${productId}`);

      return { txId, productId };
    } catch (error) {
      this.logger.error('Failed to create product on-chain', error.message);
      throw error;
    }
  }

  /**
   * Wait for Circle transaction to reach terminal state.
   */
  private async waitForCircleTransaction(txId: string, maxAttempts = 60): Promise<string | null> {
    const terminal = new Set(['COMPLETE', 'CONFIRMED', 'FAILED', 'DENIED', 'CANCELLED']);

    for (let i = 0; i < maxAttempts; i++) {
      const { data } = await this.circleDeveloperSdk.getTransaction({ id: txId });
      const tx = data?.transaction;

      const state = tx?.state;
      
      if (state && terminal.has(state)) {
        if (state === 'FAILED' || state === 'DENIED' || state === 'CANCELLED') {
          const reason = (tx as any)?.failureReason || (tx as any)?.error || '';
          this.logger.error(`Circle transaction ${txId} failed: state=${state} ${reason}`.trim());
          throw new Error(`Circle transaction ${txId} failed: state=${state} ${reason}`.trim());
        }

        const txHash = (tx as any)?.txHash || null;
        
        if (txHash) {
          this.logger.log(`Circle tx confirmed. txId=${txId} txHash=${txHash}`);
        } else {
          this.logger.warn(`Circle tx confirmed without txHash. txId=${txId}`);
        }
        return txHash;
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error(`Circle transaction timeout: ${txId}`);
  }

  /**
   * Get next product ID (total number of products created)
   */
  async getNextProductId(): Promise<number> {
    try {
      // Assuming the contract has a counter or we can query the last product ID
      // For now, we'll try to iterate until we find a non-existent product
      let productId = 1;
      while (true) {
        try {
          const product = await this.ledgerContract.products(productId);
          // Check if product exists (issuer is not zero address)
          if (product.issuer === ethers.ZeroAddress) {
            return productId;
          }
          productId++;
          if (productId > 1000) break; // Safety limit
        } catch {
          return productId;
        }
      }
      return productId;
    } catch (error) {
      this.logger.error('Failed to get next product ID', error.message);
      return 1;
    }
  }

  /**
   * List all products from blockchain
   */
  async listProducts(): Promise<any[]> {
    this.logger.log('Listing all products from blockchain');
    try {
      const products = [];
      const maxProductId = await this.getNextProductId();
      
      for (let i = 1; i < maxProductId; i++) {
        try {
          const product = await this.ledgerContract.products(i);
          if (product.issuer !== ethers.ZeroAddress) {
            products.push({
              productId: i,
              issuer: product.issuer,
              active: product.active,
              priceE6: product.priceE6.toString(),
              metadataURI: product.metadataURI,
            });
          }
        } catch (err) {
          this.logger.warn(`Failed to fetch product ${i}`);
        }
      }
      
      return products;
    } catch (error) {
      this.logger.error('Failed to list products', error.message);
      return [];
    }
  }

  /**
   * Get product details from ledger contract
   */
  async getProduct(productId: number) {
    this.logger.log(`Fetching product ${productId} from ledger contract`);
    try {
      const product = await this.ledgerContract.products(productId);
      if (product.issuer === ethers.ZeroAddress) {
        throw new Error('Product does not exist');
      }
      return {
        issuer: product.issuer,
        active: product.active,
        frozen: product.frozen,
        priceE6: product.priceE6.toString(),
        metadataURI: product.metadataURI,
      };
    } catch (error) {
      this.logger.error(`Failed to get product ${productId}`, error.message);
      throw error;
    }
  }

  /**
   * Get user's holding for a product
   */
  async getHolding(productId: number, investorAddress: string): Promise<string> {
    this.logger.log(`Fetching holding for product ${productId}, investor: ${investorAddress}`);
    try {
      const holding = await this.ledgerContract.holdingOf(productId, investorAddress);
      return holding.toString();
    } catch (error) {
      this.logger.error(`Failed to get holding for product ${productId}`, error.message);
      throw error;
    }
  }

  /**
   * Get total units for a product
   */
  async getTotalUnits(productId: number): Promise<string> {
    try {
      const total = await this.ledgerContract.totalUnits(productId);
      return total.toString();
    } catch (error) {
      this.logger.error(`Failed to get total units for product ${productId}`, error.message);
      throw error;
    }
  }

  /**
   * Get pending dividend for a user
   */
  async getPendingDividend(productId: number, investorAddress: string): Promise<string> {
    try {
      const pending = await this.distributorContract.pending(productId, investorAddress);
      return pending.toString();
    } catch (error) {
      this.logger.error(`Failed to get pending dividend for product ${productId}`, error.message);
      throw error;
    }
  }

  /**
   * Get USDC balance
   */
  async getUSDCBalance(address: string): Promise<string> {
    this.logger.log(`Fetching USDC balance for: ${address}`);
    try {
      const balance = await this.usdcContract.balanceOf(address);
      return balance.toString();
    } catch (error) {
      this.logger.error(`Failed to get USDC balance for ${address}`, error.message);
      throw error;
    }
  }

  /**
   * Allowance(owner -> ledger)
   */
  async getUSDCAllowance(ownerAddress: string): Promise<string> {
    const allowance = await this.usdcContract.allowance(ownerAddress, this.ledgerAddress);
    return allowance.toString();
  }

  /**
   * Estimate gas for subscribe transaction
   */
  async estimateSubscribeGas(productId: number, amountE6: string): Promise<string> {
    try {
      // This is a rough estimate - would need a signer for accurate estimation
      return '500000'; // 500k gas units as estimate
    } catch (error) {
      this.logger.error('Failed to estimate gas', error.message);
      throw error;
    }
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      return receipt;
    } catch (error) {
      this.logger.error(`Failed to get transaction receipt for ${txHash}`, error.message);
      throw error;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(txHash: string, confirmations = 1) {
    try {
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      return receipt;
    } catch (error) {
      this.logger.error(`Failed to wait for transaction ${txHash}`, error.message);
      throw error;
    }
  }

  /**
   * Approve USDC spending for ledger contract
   */
  async approveUSDC(walletId: string, amountE6: string): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(`Approving USDC -> Ledger amountE6=${amountE6} walletId=${walletId}`);

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.usdcAddress,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [this.ledgerAddress, amountE6],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create USDC approve transaction');

    this.logger.log(`Approve tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Subscribe to a product
   */
  async subscribe(walletId: string, productId: number, amountE6: string): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(`Subscribing product=${productId} amountE6=${amountE6} walletId=${walletId}`);

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.ledgerAddress,
      abiFunctionSignature: 'subscribe(uint256,uint256)',
      abiParameters: [productId.toString(), amountE6],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create subscribe transaction');

    this.logger.log(`Subscribe tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Set product status (activate/deactivate) and price
   */
  async setProduct(
    walletId: string,
    productId: number,
    active: boolean,
    priceE6: string,
  ): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(
      `Setting product ${productId}: active=${active}, priceE6=${priceE6}, walletId=${walletId}`
    );

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.ledgerAddress,
      abiFunctionSignature: 'setProduct(uint256,bool,uint256)',
      abiParameters: [productId.toString(), active, priceE6],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create setProduct transaction');

    this.logger.log(`SetProduct tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Refund investor by burning units and returning USDC
   */
  async refund(
    walletId: string,
    productId: number,
    investorAddress: string,
    units: string,
  ): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(
      `Refunding product=${productId} investor=${investorAddress} units=${units} walletId=${walletId}`
    );

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.ledgerAddress,
      abiFunctionSignature: 'refund(uint256,address,uint256)',
      abiParameters: [productId.toString(), investorAddress, units],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create refund transaction');

    this.logger.log(`Refund tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Get contract treasury balance (total USDC in ledger contract)
   */
  async getTreasuryBalance(): Promise<string> {
    this.logger.log('Fetching contract treasury balance');
    try {
      const balance = await this.ledgerContract.treasuryBalanceE6();
      return balance.toString();
    } catch (error) {
      this.logger.error('Failed to get treasury balance', error.message);
      throw error;
    }
  }

  /**
   * Withdraw subscription funds from contract
   * Issuer withdraws USDC from the contract
   */
  async withdrawSubscriptionFunds(
    walletId: string,
    productId: number,
    amountE6: string,
  ): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(
      `Withdrawing subscription funds: product=${productId} amountE6=${amountE6} walletId=${walletId}`
    );

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.ledgerAddress,
      abiFunctionSignature: 'withdrawSubscriptionFunds(uint256,uint256)',
      abiParameters: [productId.toString(), amountE6],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create withdrawal transaction');

    this.logger.log(`Withdrawal tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Approve USDC spending for distributor contract
   */
  async approveUSDCForDistributor(walletId: string, amountE6: string): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(`Approving USDC -> Distributor amountE6=${amountE6} walletId=${walletId}`);

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.usdcAddress,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [this.distributorAddress, amountE6],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create USDC approve transaction for distributor');

    this.logger.log(`Approve tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Declare dividend for a product
   */
  async declareDividend(
    walletId: string,
    productId: number,
    amountE6: string,
  ): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(
      `Declaring dividend: product=${productId} amountE6=${amountE6} walletId=${walletId}`
    );

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.distributorAddress,
      abiFunctionSignature: 'declareDividend(uint256,uint256)',
      abiParameters: [productId.toString(), amountE6],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create declareDividend transaction');

    this.logger.log(`DeclareDividend tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }

  /**
   * Claim dividend for a product
   */
  async claimDividend(
    walletId: string,
    productId: number,
  ): Promise<{ txId: string; txHash: string | null }> {
    this.logger.log(`Claiming dividend: product=${productId} walletId=${walletId}`);

    const response = await this.circleDeveloperSdk.createContractExecutionTransaction({
      walletId,
      contractAddress: this.distributorAddress,
      abiFunctionSignature: 'claim(uint256)',
      abiParameters: [productId.toString()],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });

    const txId = response.data?.id;
    if (!txId) throw new Error('Failed to create claim transaction');

    this.logger.log(`Claim tx created: ${txId}`);
    const txHash = await this.waitForCircleTransaction(txId);
    return { txId, txHash };
  }
}
