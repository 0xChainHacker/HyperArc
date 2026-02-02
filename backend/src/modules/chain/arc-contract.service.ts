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

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('arc.rpcUrl');
    this.ledgerAddress = this.configService.get<string>('arc.ledgerAddress');
    this.distributorAddress = this.configService.get<string>('arc.distributorAddress');
    const usdcAddress = this.configService.get<string>('arc.usdcAddress');

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.ledgerContract = new ethers.Contract(this.ledgerAddress, LedgerABI as any, this.provider);
    this.distributorContract = new ethers.Contract(this.distributorAddress, DistributorABI as any, this.provider);
    this.usdcContract = new ethers.Contract(usdcAddress, USDCABI as any, this.provider);
    
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
   * Wait for Circle transaction to reach terminal state
   */
  private async waitForCircleTransaction(txId: string, maxAttempts = 20): Promise<void> {
    const terminalStates = new Set(['COMPLETE', 'CONFIRMED', 'FAILED', 'DENIED', 'CANCELLED']);

    for (let i = 0; i < maxAttempts; i++) {
      const { data } = await this.circleDeveloperSdk.getTransaction({ id: txId });
      const state = data?.transaction?.state;

      if (state && terminalStates.has(state)) {
        if (state !== 'COMPLETE' && state !== 'CONFIRMED') {
          throw new Error(`Transaction failed with state: ${state}`);
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error('Transaction timeout');
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
      const pending = await this.distributorContract.pendingDividend(productId, investorAddress);
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
}
