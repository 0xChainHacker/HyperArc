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
  priceE6: string;
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
   * Approve and deploy product to blockchain (Admin only)
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

    try {
      // Get issuer wallet to deploy on-chain
      const issuerWallet = await this.usersService.getUserWallet(
        product.issuerUserId,
        WalletRole.ISSUER
      );

      // Deploy to blockchain
      const result = await this.arcContractService.createProduct(
        issuerWallet.walletId,
        product.issuer,
        product.priceE6,
        product.metadataURI,
      );

      // Update product status
      product.status = 'approved';
      product.active = true;
      product.approvedAt = new Date().toISOString();
      product.txHash = result.txId;

      this.saveProduct(product);

      this.logger.log(
        `Product ${productId} approved and deployed on-chain. TxHash: ${result.txId}`
      );

      return product;
    } catch (error) {
      this.logger.error(`Failed to approve product ${productId}`, error.message);
      throw new BadRequestException(
        `Failed to approve product: ${error.message}`
      );
    }
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
    return this.products.filter((p) => p.status === 'approved');
  }

  /**
   * Get product by ID
   * For approved products, fetches latest data from blockchain
   */
  async getProduct(productId: number): Promise<Product> {
    this.logger.log(`Fetching product: ${productId}`);
    
    const product = this.products.find((p) => p.productId === productId);
    if (!product) {
      throw new BadRequestException(`Product ${productId} not found`);
    }

    // For approved products, fetch latest on-chain data
    if (product.status === 'approved') {
      try {
        const onChainProduct = await this.arcContractService.getProduct(productId);
        product.active = onChainProduct.active;
        product.priceE6 = onChainProduct.priceE6;
        this.logger.log(`Updated product ${productId} with on-chain data`);
      } catch (error) {
        this.logger.warn(`Could not fetch on-chain data for product ${productId}: ${error.message}`);
      }
    }

    return product;
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
}
