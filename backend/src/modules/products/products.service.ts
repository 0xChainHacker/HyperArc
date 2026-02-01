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
  createdAt: Date;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  // In production, this would be a database
  private readonly products = new Map<number, Product>();
  private productIdCounter = 0;

  constructor(private readonly arcContractService: ArcContractService) {}

  /**
   * Create a new economic interest product
   */
  async createProduct(dto: CreateProductDto): Promise<Product> {
    this.logger.log(`Creating product: ${dto.name}, issuer: ${dto.issuerAddress}, price: ${dto.priceE6}`);

    // In production, this would call the ledger contract via a signer
    // For now, we simulate the product creation
    const productId = ++this.productIdCounter;

    const product: Product = {
      productId,
      name: dto.name,
      description: dto.description,
      issuer: dto.issuerAddress,
      active: true,
      priceE6: dto.priceE6,
      metadataURI: dto.metadataURI || '',
      createdAt: new Date(),
    };

    this.products.set(productId, product);
    this.logger.log(`Product created with ID: ${productId}`);

    return product;
  }

  /**
   * Get all products
   */
  async listProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  /**
   * Get product by ID
   */
  async getProduct(productId: number): Promise<Product> {
    this.logger.log(`Fetching product: ${productId}`);
    const product = this.products.get(productId);
    if (!product) {
      throw new BadRequestException(`Product ${productId} not found`);
    }

    // Fetch on-chain data
    try {
      const onChainProduct = await this.arcContractService.getProduct(productId);
      product.active = onChainProduct.active;
      product.priceE6 = onChainProduct.priceE6;
    } catch (error) {
      this.logger.warn(`Could not fetch on-chain data for product ${productId}`);
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
