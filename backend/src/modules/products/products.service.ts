import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ArcContractService } from '../chain/arc-contract.service';
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

  constructor(private readonly arcContractService: ArcContractService) {}

  /**
   * Create a new economic interest product on-chain
   * @param dto - Product creation data
   * @param walletId - Circle wallet ID to use for signing the transaction
   */
  async createProduct(dto: CreateProductDto, walletId?: string): Promise<Product> {
    this.logger.log(`Creating product on-chain: ${dto.name}, issuer: ${dto.issuerAddress}, price: ${dto.priceE6}`);
    
    if (!walletId) {
      throw new BadRequestException(
        'walletId is required to create product on-chain. Please provide a Circle wallet ID with signing capability.'
      );
    }

    try {
      // Create product on-chain
      const result = await this.arcContractService.createProduct(
        walletId,
        dto.issuerAddress,
        dto.priceE6,
        dto.metadataURI || '',
      );

      this.logger.log(`Product created successfully. TxId: ${result.txId}, ProductId: ${result.productId}`);

      // Fetch the created product from blockchain
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
