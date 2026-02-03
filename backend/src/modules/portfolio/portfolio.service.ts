import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ArcContractService } from '../chain/arc-contract.service';
import { ProductsService } from '../products/products.service';
import { UsersService, WalletRole } from '../users/users.service';

export interface PortfolioHolding {
  productId: number;
  productName: string;
  units: string;
  pendingDividend: string;
}

export interface Portfolio {
  userId: string;
  arcAddress: string;
  usdcBalance: string;
  holdings: PortfolioHolding[];
  totalPendingDividends: string;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly arcContractService: ArcContractService,
    private readonly productsService: ProductsService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Get user's complete portfolio
   */
  async getPortfolio(userId: string): Promise<Portfolio> {
    this.logger.log(`Fetching portfolio for user ${userId}`);

    // Get investor wallet (portfolio is for investors)
    const userWallet = await this.usersService.getOrCreateWallet(
      userId,
      WalletRole.INVESTOR,
      ['ARC-TESTNET']
    );
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');

    if (!arcAddress) {
      return {
        userId,
        arcAddress: '',
        usdcBalance: '0',
        holdings: [],
        totalPendingDividends: '0',
      };
    }

    // Get USDC balance
    const usdcBalance = await this.arcContractService.getUSDCBalance(arcAddress);

    // Get all products
    const products = await this.productsService.listProducts();

    // Get holdings and pending dividends for each product
    const holdings: PortfolioHolding[] = [];
    let totalPending = BigInt(0);

    for (const product of products) {
      try {
        const units = await this.arcContractService.getHolding(product.productId, arcAddress);
        
        if (units !== '0') {
          const pendingDividend = await this.arcContractService.getPendingDividend(
            product.productId,
            arcAddress,
          );

          holdings.push({
            productId: product.productId,
            productName: product.name,
            units,
            pendingDividend,
          });

          totalPending += BigInt(pendingDividend);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch data for product ${product.productId}`, error.message);
      }
    }

    return {
      userId,
      arcAddress,
      usdcBalance,
      holdings,
      totalPendingDividends: totalPending.toString(),
    };
  }

  /**
   * Get user holdings for a specific product
   */
  async getProductHolding(userId: string, productId: number) {
    const userWallet = await this.usersService.getOrCreateWallet(
      userId,
      WalletRole.INVESTOR,
      ['ARC-TESTNET']
    );
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');

    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }

    const units = await this.arcContractService.getHolding(productId, arcAddress);
    const pendingDividend = await this.arcContractService.getPendingDividend(productId, arcAddress);

    return {
      userId,
      productId,
      units,
      pendingDividend,
    };
  }

  /**
   * Get USDC balance for user's wallet
   */
  async getUSDCBalance(userId: string, role?: string) {
    const walletRole = role === 'issuer' ? WalletRole.ISSUER : WalletRole.INVESTOR;
    
    const userWallet = await this.usersService.getOrCreateWallet(
      userId,
      walletRole,
      ['ARC-TESTNET']
    );
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');

    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }

    const balance = await this.arcContractService.getUSDCBalance(arcAddress);

    return {
      userId,
      role: walletRole,
      address: arcAddress,
      balanceE6: balance,
      balanceUSDC: (Number(balance) / 1e6).toFixed(2),
    };
  }

  /**
   * Get USDC allowance for ledger contract
   */
  async getUSDCAllowance(userId: string, role?: string) {
    const walletRole = role === 'issuer' ? WalletRole.ISSUER : WalletRole.INVESTOR;
    
    const userWallet = await this.usersService.getOrCreateWallet(
      userId,
      walletRole,
      ['ARC-TESTNET']
    );
    const arcAddress = this.usersService.getAddressForBlockchain(userWallet, 'ARC-TESTNET');

    if (!arcAddress) {
      throw new BadRequestException(
        'User does not have an Arc address. Please create wallet with ARC-TESTNET blockchain.'
      );
    }

    const allowance = await this.arcContractService.getUSDCAllowance(arcAddress);

    return {
      userId,
      role: walletRole,
      address: arcAddress,
      allowanceE6: allowance,
      allowanceUSDC: (Number(allowance) / 1e6).toFixed(2),
    };
  }
}
