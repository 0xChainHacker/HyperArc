import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ArcContractService } from '../chain/arc-contract.service';
import { UsersService, WalletRole } from '../users/users.service';
import { CreateProductDto } from './dto/product.dto';
import { KVService } from '../kv/kv.service';

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
  private readonly kvProductsKey = 'products:list';
  private readonly kvMetadataKey = 'products:metadata';
  private products: Product[] = [];
  private nextProductId = 1;

  constructor(
    private readonly arcContractService: ArcContractService,
    private readonly usersService: UsersService,
    private readonly kvService: KVService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadProductsFromStorage();
  }

  /**
   * Admin utility: sync local product files (and metadata) to KV as per-key entries and index
   */
  async syncLocalProductsToKV(): Promise<{ imported: number }> {
    const fs = require('fs');
    const path = require('path');
    try {
      if (!fs.existsSync(this.productsDir)) {
        return { imported: 0 };
      }

      const files = fs.readdirSync(this.productsDir).filter((f: string) => f.startsWith('product-') && f.endsWith('.json'));
      const products: Product[] = [];
      for (const file of files) {
        try {
          const data = fs.readFileSync(path.join(this.productsDir, file), 'utf8');
          const p = JSON.parse(data);
          products.push(p);
        } catch (e) {
          this.logger.warn(`Failed to parse ${file}: ${e?.message || e}`);
        }
      }

      // metadata
      let meta = { nextProductId: this.nextProductId };
      if (fs.existsSync(this.metadataFile)) {
        try {
          meta = JSON.parse(fs.readFileSync(this.metadataFile, 'utf8'));
        } catch (e) {
          this.logger.warn('Failed to parse metadata file', e?.message || e);
        }
      }

      if (this.kvService?.isAvailable && this.kvService.isAvailable()) {
        try {
          // write each product
          for (const p of products) {
            await this.kvService.set(`product-${p.productId}`, JSON.stringify(p, null, 2));
          }
          const ids = products.map(p => p.productId);
          await this.kvService.set(this.kvProductsKey, JSON.stringify(ids));
          await this.kvService.set(this.kvMetadataKey, JSON.stringify(meta));
          this.logger.log(`Synced ${products.length} products and metadata to KV`);
        } catch (e) {
          this.logger.error('Failed to write products to KV', e?.message || e);
          throw e;
        }
      }

      return { imported: products.length };
    } catch (err: any) {
      this.logger.error('syncLocalProductsToKV failed', err?.message || err);
      return { imported: 0 };
    }
  }

  /**
   * Load all products from individual JSON files in /data/product/
   */
  private async loadProductsFromStorage() {
    try {
      // Try KV first
      if (this.kvService?.isAvailable && this.kvService.isAvailable()) {
        const raw = await this.kvService.get(this.kvProductsKey);
        const metaRaw = await this.kvService.get(this.kvMetadataKey);
        if (metaRaw) {
          try {
            const meta = JSON.parse(metaRaw as any);
            this.nextProductId = meta.nextProductId || this.nextProductId;
          } catch (e) {
            this.logger.warn('Failed to parse products metadata from KV', e?.message || e);
          }
        }

        if (raw) {
          try {
            const parsed = JSON.parse(raw as any);

            // Support two KV formats:
            // 1) Entire products array stored at kvProductsKey (backwards-compat)
            // 2) Index array of productIds stored at kvProductsKey, with each product at key `product-{id}`
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0].productId) {
              this.products = parsed as Product[];
              this.logger.log(`Loaded ${this.products.length} products (full array) from Vercel KV`);
              return;
            }

            // If parsed is array of ids, fetch each product key
            if (Array.isArray(parsed)) {
              const ids: number[] = parsed.map((v: any) => Number(v)).filter(n => !isNaN(n));
              const items: Product[] = [];
              for (const id of ids) {
                try {
                  const itemRaw = await this.kvService.get(`product-${id}`);
                  if (itemRaw) {
                    const item = JSON.parse(itemRaw as any);
                    items.push(item);
                  }
                } catch (ie) {
                  this.logger.warn(`Failed to load product-${id} from KV`, ie?.message || ie);
                }
              }
              if (items.length > 0) {
                this.products = items;
                this.logger.log(`Loaded ${this.products.length} products (per-key) from Vercel KV`);
                return;
              }
            }
          } catch (e) {
            this.logger.warn('Failed to parse products list from KV', e?.message || e);
          }
        }
      }

      // Fallback to filesystem
      const fs = require('fs');
      const path = require('path');
      if (!fs.existsSync(this.productsDir)) {
        fs.mkdirSync(this.productsDir, { recursive: true });
      }

      // Load metadata
      if (fs.existsSync(this.metadataFile)) {
        const metaData = fs.readFileSync(this.metadataFile, 'utf8');
        const meta = JSON.parse(metaData);
        this.nextProductId = meta.nextProductId || this.nextProductId;
      } else {
        await this.saveMetadata();
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
    } catch (error: any) {
      this.logger.error('Failed to load products from storage', error?.message || error);
      this.products = [];
    }
  }

  /**
   * Save metadata (nextProductId)
   */
  private async saveMetadata() {
    try {
      const payload = JSON.stringify({ nextProductId: this.nextProductId }, null, 2);
      if (this.kvService?.isAvailable && this.kvService.isAvailable()) {
        await this.kvService.set(this.kvMetadataKey, payload);
        this.logger.log('Saved products metadata to Vercel KV');
      }
      const fs = require('fs');
      fs.writeFileSync(this.metadataFile, payload, 'utf8');
    } catch (error: any) {
      this.logger.error('Failed to save metadata', error?.message || error);
    }
  }

  /**
   * Save a single product to its own JSON file
   */
  private async saveProduct(product: Product) {
    try {
      const data = JSON.stringify(product, null, 2);
      // Update in-memory
      const idx = this.products.findIndex(p => p.productId === product.productId);
      if (idx >= 0) this.products[idx] = product;
      else this.products.push(product);

      // Persist to KV: write single product key and update index
      if (this.kvService?.isAvailable && this.kvService.isAvailable()) {
        try {
          // write per-product key
          await this.kvService.set(`product-${product.productId}`, JSON.stringify(product, null, 2));
          // update index (store array of ids)
          const ids = this.products.map(p => p.productId);
          await this.kvService.set(this.kvProductsKey, JSON.stringify(ids));
          this.logger.log(`Saved product ${product.productId} to Vercel KV (per-key) and updated index`);
        } catch (e) {
          this.logger.warn('Failed to save product to KV', e?.message || e);
        }
      }

      // Also write to filesystem for local dev
      const fs = require('fs');
      const path = require('path');
      const fileName = `product-${product.productId}.json`;
      const filePath = path.join(this.productsDir, fileName);
      fs.writeFileSync(filePath, data, 'utf8');
      this.logger.log(`Saved product ${product.productId} to ${fileName}`);
    } catch (error: any) {
      this.logger.error(`Failed to save product ${product.productId}`, error?.message || error);
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
      await this.saveProduct(product);
      await this.saveMetadata();

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

    await this.saveProduct(product);

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
    await this.saveProduct(product);

    this.logger.log(`Product ${productId} rejected${reason ? `: ${reason}` : ''}`);

    return product;
  }

  /**
   * Get pending products (for admin review)
   */
  async getPendingProducts(): Promise<Product[]> {
    // If KV is available, attempt to refresh products from KV so external writes
    // (e.g., another process writing to Upstash) are reflected without restart.
    try {
      if (this.kvService?.isAvailable && this.kvService.isAvailable()) {
        const raw = await this.kvService.get(this.kvProductsKey);
        if (raw) {
          try {
            const parsed = JSON.parse(raw as any);
            // Full-array format
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0].productId) {
              this.products = parsed as Product[];
            } else if (Array.isArray(parsed)) {
              // parsed is array of ids
              const ids: number[] = parsed.map((v: any) => Number(v)).filter(n => !isNaN(n));
              const items: Product[] = [];
              for (const id of ids) {
                try {
                  const itemRaw = await this.kvService.get(`product-${id}`);
                  if (itemRaw) {
                    const item = JSON.parse(itemRaw as any);
                    items.push(item);
                  }
                } catch (ie) {
                  this.logger.warn(`Failed to load product-${id} from Upstash`, ie?.message || ie);
                }
              }
              if (items.length > 0) this.products = items;
            }
          } catch (e) {
            this.logger.warn('Failed to parse products list from Upstash', e?.message || e);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn('Failed to refresh pending products from Upstash', err?.message || err);
    }

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
        await this.saveProduct(localProduct);
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
