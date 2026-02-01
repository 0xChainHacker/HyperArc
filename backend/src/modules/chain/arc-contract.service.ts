import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
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

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('arc.rpcUrl');
    const ledgerAddress = this.configService.get<string>('arc.ledgerAddress');
    const distributorAddress = this.configService.get<string>('arc.distributorAddress');
    const usdcAddress = this.configService.get<string>('arc.usdcAddress');

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.ledgerContract = new ethers.Contract(ledgerAddress, LedgerABI as any, this.provider);
    this.distributorContract = new ethers.Contract(distributorAddress, DistributorABI as any, this.provider);
    this.usdcContract = new ethers.Contract(usdcAddress, USDCABI as any, this.provider);
  }

  /**
   * Get product details from ledger contract
   */
  async getProduct(productId: number) {
    try {
      const product = await this.ledgerContract.products(productId);
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
