import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ArcContractService } from '../chain/arc-contract.service';
import { UsersService, WalletRole } from '../users/users.service';
import { CreateProductDto } from './dto/product.dto';

export interface Product {
  productId: number;
  name: string;
  description: string;
  issuer: string;
  active: boolean;
  priceE6: string;
  metadataURI: string;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly arcContractService: ArcContractService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Create a new economic interest product on-chain
   * Uses the issuer's own wallet to create and sign the transaction
   * @param dto - Product creation data
   * @param issuerUserId - User ID of the issuer (SPV/product creator)
   */
  async createProduct(dto: CreateProductDto, issuerUserId?: string): Promise<Product> {
    this.logger.log(`Creating product on-chain: ${dto.name}, issuer: ${dto.issuerAddress}, price: ${dto.priceE6}`);
    
    if (!issuerUserId) {
      throw new BadRequestException(
        'issuerUserId is required. Only the issuer can create products using their own wallet.'
      );
    }

    try {
      // 1. Get existing Issuer wallet
      const issuerWallet = await this.usersService.getUserWallet(
        issuerUserId,
        WalletRole.ISSUER
      );

      this.logger.log(
        `Using issuer wallet: ${issuerWallet.walletId}, address: ${issuerWallet.address}`
      );

      // 2. Verify issuerAddress matches wallet address
      if (dto.issuerAddress.toLowerCase() !== issuerWallet.address.toLowerCase()) {
        this.logger.warn(
          `Issuer address mismatch for user ${issuerUserId}. ` +
          `Expected: ${issuerWallet.address}, Provided: ${dto.issuerAddress}`
        );
        throw new BadRequestException(
          'Issuer address does not match your wallet address'
        );
      }

      // 3. Create product on-chain
      const result = await this.arcContractService.createProduct(
        issuerWallet.walletId,
        dto.issuerAddress,
        dto.priceE6,
        dto.metadataURI || '',
      );

      this.logger.log(`Product created successfully. TxId: ${result.txId}, ProductId: ${result.productId}`);

      // 4. Fetch the created product from blockchain
      if (result.productId) {
        return await this.getProduct(result.productId);
      }

      // Fallback return
      return {
        productId: result.productId || 0,
        name: dto.name,
        description: dto.description,
        issuer: dto.issuerAddress,
        active: true,
        priceE6: dto.priceE6,
        metadataURI: dto.metadataURI || '',
      };
    } catch (error) {
      this.logger.error('Failed to create product on-chain', error.message);
      throw new BadRequestException(
        `Failed to create product on-chain: ${error.message}`
      );
    }
  }

  /**
   * Get all products from blockchain
   */
  async listProducts(): Promise<Product[]> {
    this.logger.log('Fetching products from blockchain');
    try {
      const onChainProducts = await this.arcContractService.listProducts();
      
      return onChainProducts.map((p) => ({
        productId: p.productId,
        name: `Product ${p.productId}`, // TODO: fetch from metadataURI (IPFS)
        description: p.metadataURI || 'No description available',
        issuer: p.issuer,
        active: p.active,
        priceE6: p.priceE6,
        metadataURI: p.metadataURI,
      }));
    } catch (error) {
      this.logger.error('Failed to list products from blockchain', error.message);
      return [];
    }
  }

  /**
   * Get product by ID from blockchain
   */
  async getProduct(productId: number): Promise<Product> {
    this.logger.log(`Fetching product: ${productId}`);
    
    try {
      const onChainProduct = await this.arcContractService.getProduct(productId);
      
      return {
        productId,
        name: `Product ${productId}`, // TODO: fetch from metadataURI
        description: onChainProduct.metadataURI || 'No description available',
        issuer: onChainProduct.issuer,
        active: onChainProduct.active,
        priceE6: onChainProduct.priceE6,
        metadataURI: onChainProduct.metadataURI,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch product ${productId} from blockchain`, error.message);
      throw new BadRequestException(`Product ${productId} not found on blockchain`);
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
}
