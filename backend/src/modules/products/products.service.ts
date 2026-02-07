import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ArcContractService } from '../chain/arc-contract.service';
import { UsersService, WalletRole } from '../users/users.service';
import { CreateProductDto } from './dto/product.dto';

export interface Product {
  productId: number;
  name: string;
  description: string;
  issuer: string;
  issuerUserId?: string;
  active: boolean;
  frozen?: boolean;
  priceE6: string;
  subscriptionPoolE6?: string;
  metadataURI: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  approvedAt?: string;
  txHash?: string;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private readonly productsDir = './data/product';
  private readonly metadataFile = './data/product/metadata.json';
  private products: Product[] = [];
  private nextProductId = 1;

  constructor(
    private readonly arcContractService: ArcContractService,
    private readonly usersService: UsersService,
  ) {
    this.loadProducts();
  }

  /**
   * Load all products from individual JSON files in /data/product/
   */
  private loadProducts() {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Create directory if not exists
      if (!fs.existsSync(this.productsDir)) {
        fs.mkdirSync(this.productsDir, { recursive: true });
      }

      // Load metadata (nextProductId)
      if (fs.existsSync(this.metadataFile)) {
        const metaData = fs.readFileSync(this.metadataFile, 'utf8');
        const meta = JSON.parse(metaData);
        this.nextProductId = meta.nextProductId || 1;
      } else {
        this.saveMetadata();
      }

      // Load all product files
      const files = fs.readdirSync(this.productsDir);
      this.products = [];
      
      for (const file of files) {
        if (file.startsWith('product-') && file.endsWith('.json')) {
          const filePath = path.join(this.productsDir, file);
          const data = fs.readFileSync(filePath, 'utf8');
          const product = JSON.parse(data);
          this.products.push(product);
        }
      }

      this.logger.log(`Loaded ${this.products.length} products from ${this.productsDir}`);
    } catch (error) {
      this.logger.error('Failed to load products from directory', error.message);
      this.products = [];
    }
  }

  /**
   * Save metadata (nextProductId)
   */
  private saveMetadata() {
    try {
      const fs = require('fs');
      const data = JSON.stringify({ nextProductId: this.nextProductId }, null, 2);
      fs.writeFileSync(this.metadataFile, data, 'utf8');
    } catch (error) {
      this.logger.error('Failed to save metadata', error.message);
    }
  }

  /**
   * Save a single product to its own JSON file
   */
  private saveProduct(product: Product) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const fileName = `product-${product.productId}.json`;
      const filePath = path.join(this.productsDir, fileName);
      
      const data = JSON.stringify(product, null, 2);
      fs.writeFileSync(filePath, data, 'utf8');
      
      this.logger.log(`Saved product ${product.productId} to ${fileName}`);
    } catch (error) {
      this.logger.error(`Failed to save product ${product.productId}`, error.message);
    }
  }

  /**
   * Create a new product request (pending admin approval)
   * Issuer submits product for review
   * @param dto - Product creation data
   * @param issuerUserId - User ID of the issuer (SPV/product creator)
   */
  async createProduct(dto: CreateProductDto, issuerUserId: string): Promise<Product> {
    this.logger.log(`Creating product request: ${dto.name}, issuer: ${dto.issuerAddress}, price: ${dto.priceE6}`);
    
    if (!issuerUserId) {
      throw new BadRequestException(
        'issuerUserId is required. Only the issuer can create products.'
      );
    }

    try {
      // Verify issuer has wallet
      const issuerWallet = await this.usersService.getUserWallet(
        issuerUserId,
        WalletRole.ISSUER
      );

      const arcAddress = this.usersService.getAddressForBlockchain(issuerWallet, 'ARC-TESTNET');
      
      if (!arcAddress) {
        throw new BadRequestException(
          'Issuer wallet does not have an address on ARC-TESTNET.'
        );
      }

      // Verify issuer address matches
      if (dto.issuerAddress.toLowerCase() !== arcAddress.toLowerCase()) {
        throw new BadRequestException(
          'Issuer address does not match your wallet address on ARC-TESTNET'
        );
      }

      // Create product in pending status
      const product: Product = {
        productId: this.nextProductId++,
        name: dto.name,
        description: dto.description,
        issuer: dto.issuerAddress,
        issuerUserId,
        active: false,
        priceE6: dto.priceE6,
        metadataURI: dto.metadataURI || '',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      this.products.push(product);
      this.saveProduct(product);
      this.saveMetadata();

      this.logger.log(
        `Product request created successfully. ` +
        `ProductId: ${product.productId}, Status: pending, awaiting admin approval`
      );

      return product;
    } catch (error) {
      this.logger.error('Failed to create product request', error.message);
      throw new BadRequestException(
        `Failed to create product request: ${error.message}`
      );
    }
  }

  /**
   * Approve product (Admin only)
   * Note: This only updates status. Deployment to blockchain is done separately via script.
   */
  async approveProduct(productId: number, adminUserId: string): Promise<Product> {
    this.logger.log(`Admin ${adminUserId} approving product ${productId}`);

    const product = this.products.find((p) => p.productId === productId);
    if (!product) {
      throw new BadRequestException(`Product ${productId} not found`);
    }

    if (product.status !== 'pending') {
      throw new BadRequestException(
        `Product ${productId} is already ${product.status}. Can only approve pending products.`
      );
    }

    // Update product status to approved and set active to true
    product.status = 'approved';
    product.active = true;
    product.approvedAt = new Date().toISOString();

    this.saveProduct(product);

    this.logger.log(
      `Product ${productId} approved. Deployment to blockchain should be done via separate script.`
    );

    return product;
  }

  /**
   * Reject product (Admin only)
   */
  async rejectProduct(productId: number, adminUserId: string, reason?: string): Promise<Product> {
    this.logger.log(`Admin ${adminUserId} rejecting product ${productId}`);

    const product = this.products.find((p) => p.productId === productId);
    if (!product) {
      throw new BadRequestException(`Product ${productId} not found`);
    }

    if (product.status !== 'pending') {
      throw new BadRequestException(
        `Product ${productId} is already ${product.status}. Can only reject pending products.`
      );
    }

    product.status = 'rejected';
    this.saveProduct(product);

    this.logger.log(`Product ${productId} rejected${reason ? `: ${reason}` : ''}`);

    return product;
  }

  /**
   * Get pending products (for admin review)
   */
  async getPendingProducts(): Promise<Product[]> {
    return this.products.filter((p) => p.status === 'pending');
  }

  /**
   * Get all approved products
   */
  async listProducts(): Promise<Product[]> {
    const approved = this.products.filter((p) => p.status === 'approved');

    // Merge on-chain data (including subscriptionPoolE6) when available
    const merged = await Promise.all(
      approved.map(async (p) => {
        try {
          const onChain = await this.arcContractService.getProduct(p.productId);
          return {
            ...p,
            issuer: onChain.issuer,
            active: onChain.active,
            frozen: onChain.frozen,
            priceE6: onChain.priceE6,
            metadataURI: onChain.metadataURI || p.metadataURI,
            subscriptionPoolE6: onChain.subscriptionPoolE6 ?? p.subscriptionPoolE6,
          } as Product;
        } catch (e) {
          // If on-chain fetch fails, return local product
          return p;
        }
      }),
    );

    return merged;
  }

  /**
   * Get product by ID
   * Fetches data from blockchain
   */
  async getProduct(productId: number): Promise<Product> {
    this.logger.log(`Fetching product: ${productId}`);
    
    try {
      const onChainProduct = await this.arcContractService.getProduct(productId);
      
      // Find local product data for additional info
      const localProduct = this.products.find((p) => p.productId === productId);
      
      // Merge on-chain data with local metadata
      const product: Product = {
        productId,
        name: localProduct?.name || `Product ${productId}`,
        description: localProduct?.description || '',
        issuer: onChainProduct.issuer,
        issuerUserId: localProduct?.issuerUserId,
        active: onChainProduct.active,
        frozen: onChainProduct.frozen,
        priceE6: onChainProduct.priceE6,
        subscriptionPoolE6: onChainProduct.subscriptionPoolE6,
        metadataURI: onChainProduct.metadataURI || localProduct?.metadataURI || '',
        status: localProduct?.status || 'approved',
        createdAt: localProduct?.createdAt || new Date().toISOString(),
        approvedAt: localProduct?.approvedAt,
        txHash: localProduct?.txHash,
      };
      
      this.logger.log(`Fetched product ${productId} from blockchain`);
      return product;
    } catch (error) {
      this.logger.error(`Failed to fetch product ${productId} from blockchain: ${error.message}`);
      throw new BadRequestException(
        `Product ${productId} not found on blockchain`
      );
    }
  }

  /**
   * Get product total units
   */
  async getProductTotalUnits(productId: number): Promise<string> {
    try {
      return await this.arcContractService.getTotalUnits(productId);
    } catch (error) {
      this.logger.error(`Failed to get total units for product ${productId}`, error.message);
      return '0';
    }
  }

  /**
   * Deactivate product to prevent new investments
   * This should be called before refunding investors
   */
  async deactivateProduct(productId: number, issuerUserId: string) {
    this.logger.log(`Deactivating product ${productId} by issuer ${issuerUserId}`);

    if (!issuerUserId) {
      throw new BadRequestException('issuerUserId is required');
    }

    try {
      // Verify issuer has wallet
      const issuerWallet = await this.usersService.getUserWallet(
        issuerUserId,
        WalletRole.ISSUER
      );

      const walletId = issuerWallet.circleWallet['ARC-TESTNET']?.walletId;
      if (!walletId) {
        throw new BadRequestException('Issuer wallet does not have ARC-TESTNET chain configured');
      }

      // Get current product info from blockchain
      const product = await this.arcContractService.getProduct(productId);

      // Call setProduct with active=false
      const result = await this.arcContractService.setProduct(
        walletId,
        productId,
        false,  // active = false
        product.priceE6,
      );

      // Update local product status
      const localProduct = this.products.find((p) => p.productId === productId);
      if (localProduct) {
        localProduct.active = false;
        this.saveProduct(localProduct);
      }

      this.logger.log(`Product ${productId} deactivated successfully`);

      return {
        success: true,
        productId,
        txId: result.txId,
        txHash: result.txHash,
        message: 'Product deactivated successfully. New investments are now disabled.',
      };
    } catch (error) {
      this.logger.error(`Failed to deactivate product ${productId}`, error.message);
      throw new BadRequestException(`Failed to deactivate product: ${error.message}`);
    }
  }

  /**
   * Refund investor by burning units and returning USDC
   * Product must be deactivated first to prevent race conditions
   */
  async refundInvestor(productId: number, dto: any) {
    this.logger.log(
      `Refunding investor ${dto.investorAddress} for product ${productId}, units: ${dto.units}`
    );

    if (!dto.issuerUserId) {
      throw new BadRequestException('issuerUserId is required');
    }

    try {
      // Verify issuer has wallet
      const issuerWallet = await this.usersService.getUserWallet(
        dto.issuerUserId,
        WalletRole.ISSUER
      );

      const walletId = issuerWallet.circleWallet['ARC-TESTNET']?.walletId;
      if (!walletId) {
        throw new BadRequestException('Issuer wallet does not have ARC-TESTNET chain configured');
      }

      // Verify product is deactivated
      const product = await this.arcContractService.getProduct(productId);
      if (product.active) {
        throw new BadRequestException(
          'Product must be deactivated before refunding investors. Call /deactivate first.'
        );
      }

      // Verify investor has sufficient holdings
      const holding = await this.arcContractService.getHolding(
        productId,
        dto.investorAddress
      );

      if (BigInt(holding) < BigInt(dto.units)) {
        throw new BadRequestException(
          `Investor only has ${holding} units, cannot refund ${dto.units} units`
        );
      }

      // Execute refund on blockchain
      const result = await this.arcContractService.refund(
        walletId,
        productId,
        dto.investorAddress,
        dto.units,
      );

      this.logger.log(
        `Refund successful. Product ${productId}, Investor ${dto.investorAddress}, Units: ${dto.units}`
      );

      return {
        success: true,
        productId,
        investorAddress: dto.investorAddress,
        units: dto.units,
        txId: result.txId,
        txHash: result.txHash,
        message: 'Investor refunded successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to refund investor for product ${productId}`,
        error.message
      );
      throw new BadRequestException(`Failed to refund investor: ${error.message}`);
    }
  }

  /**
   * Withdraw subscription funds from contract
   * Issuer withdraws USDC that investors paid for subscriptions
   */
  async withdrawSubscriptionFunds(productId: number, dto: any) {
    this.logger.log(
      `Issuer withdrawing ${dto.amountE6} USDC from product ${productId}`
    );

    if (!dto.issuerUserId) {
      throw new BadRequestException('issuerUserId is required');
    }

    try {
      // Verify issuer has wallet
      const issuerWallet = await this.usersService.getUserWallet(
        dto.issuerUserId,
        WalletRole.ISSUER
      );

      const walletId = issuerWallet.circleWallet['ARC-TESTNET']?.walletId;
      if (!walletId) {
        throw new BadRequestException('Issuer wallet does not have ARC-TESTNET chain configured');
      }

      // Get product to verify issuer
      const product = await this.arcContractService.getProduct(productId);
      const issuerAddress = issuerWallet.circleWallet['ARC-TESTNET']?.address;

      if (product.issuer.toLowerCase() !== issuerAddress.toLowerCase()) {
        throw new BadRequestException(
          'Only the product issuer can withdraw subscription funds'
        );
      }

      // Check contract balance
      const treasuryBalance = await this.arcContractService.getTreasuryBalance();
      if (BigInt(treasuryBalance) < BigInt(dto.amountE6)) {
        throw new BadRequestException(
          `Insufficient contract balance. Available: ${treasuryBalance}, Requested: ${dto.amountE6}`
        );
      }

      // Execute withdrawal on blockchain
      const result = await this.arcContractService.withdrawSubscriptionFunds(
        walletId,
        productId,
        dto.amountE6,
      );

      this.logger.log(
        `Withdrawal successful. Product ${productId}, Amount: ${dto.amountE6} USDC`
      );

      return {
        success: true,
        productId,
        amountE6: dto.amountE6,
        txId: result.txId,
        txHash: result.txHash,
        message: 'Subscription funds withdrawn successfully',
      };
    } catch (error) {
      this.logger.error(
        `Failed to withdraw funds for product ${productId}`,
        error.message
      );
      throw new BadRequestException(`Failed to withdraw funds: ${error.message}`);
    }
  }

  /**
   * Get contract treasury balance
   */
  async getTreasuryBalance() {
    try {
      const balance = await this.arcContractService.getTreasuryBalance();
      return {
        balanceE6: balance,
        balanceUSDC: (Number(balance) / 1e6).toFixed(2),
      };
    } catch (error) {
      this.logger.error('Failed to get treasury balance', error.message);
      throw new BadRequestException(`Failed to get treasury balance: ${error.message}`);
    }
  }
}
