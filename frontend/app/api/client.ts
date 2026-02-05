// API Client for HyperArc Backend

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface Product {
  id: number;
  name: string;
  description: string;
  issuerAddress: string;
  priceE6: string;
  price: number;
  metadataURI: string;
  contractAddress?: string;
  active: boolean;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  totalUnits?: number;
  soldUnits?: number;
  category?: string;
  apy?: string;
}

export interface PortfolioHolding {
  productId: number;
  productName: string;
  units: number;
  pendingDividend: number;
  invested: number;
}

export interface WalletInfo {
  userId: string;
  role: string;
  walletId: string;
  addresses: {
    blockchain: string;
    address: string;
  }[];
}

export interface BalanceInfo {
  balance: string;
  balanceUSD: number;
}

class HyperArcAPI {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Authentication
  async getNonce(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/auth/nonce`);
    if (!response.ok) throw new Error('Failed to get nonce');
    const data = await response.json();
    return data.nonce;
  }

  async verifySiwe(message: string, signature: string): Promise<{
    accessToken: string;
    userId: string;
    role: string;
    address: string;
  }> {
    const response = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'SIWE verification failed');
    }
    return response.json();
  }

  // Wallet Management
  async createWallet(userId: string, role: 'investor' | 'issuer' | 'admin' = 'investor', blockchains: string = 'ARC-TESTNET'): Promise<WalletInfo> {
    const response = await fetch(`${this.baseUrl}/wallets/${userId}?role=${role}&blockchains=${blockchains}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to create wallet');
    return response.json();
  }

  async getWallet(userId: string, role?: 'investor' | 'issuer' | 'admin'): Promise<WalletInfo | WalletInfo[]> {
    const url = role 
      ? `${this.baseUrl}/wallets/${userId}?role=${role}`
      : `${this.baseUrl}/wallets/${userId}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to get wallet');
    return response.json();
  }

  async getWalletBalance(userId: string, role: 'investor' | 'issuer' = 'investor'): Promise<BalanceInfo> {
    const response = await fetch(`${this.baseUrl}/wallets/${userId}/balance?role=${role}`);
    if (!response.ok) throw new Error('Failed to get balance');
    return response.json();
  }

  // Products
  async listProducts(): Promise<Product[]> {
    const response = await fetch(`${this.baseUrl}/products`);
    if (!response.ok) throw new Error('Failed to list products');
    return response.json();
  }

  async getPendingProducts(): Promise<Product[]> {
    const response = await fetch(`${this.baseUrl}/products/pending`);
    if (!response.ok) throw new Error('Failed to get pending products');
    return response.json();
  }

  async getProductDetails(productId: number): Promise<Product> {
    const response = await fetch(`${this.baseUrl}/products/${productId}`);
    if (!response.ok) throw new Error('Failed to get product details');
    return response.json();
  }

  async createProduct(productData: {
    name: string;
    description: string;
    issuerAddress: string;
    priceE6: string;
    metadataURI: string;
    issuerUserId: string;
  }): Promise<Product> {
    const response = await fetch(`${this.baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productData),
    });
    if (!response.ok) throw new Error('Failed to create product');
    return response.json();
  }

  async approveProduct(productId: number, adminUserId: string): Promise<Product> {
    const response = await fetch(`${this.baseUrl}/products/${productId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUserId }),
    });
    if (!response.ok) throw new Error('Failed to approve product');
    return response.json();
  }

  async rejectProduct(productId: number, adminUserId: string, reason?: string): Promise<Product> {
    const response = await fetch(`${this.baseUrl}/products/${productId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUserId, reason }),
    });
    if (!response.ok) throw new Error('Failed to reject product');
    return response.json();
  }

  async deactivateProduct(productId: number, issuerUserId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/products/${productId}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId }),
    });
    if (!response.ok) throw new Error('Failed to deactivate product');
    return response.json();
  }

  async refundInvestor(productId: number, issuerUserId: string, investorAddress: string, units: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/products/${productId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId, investorAddress, units }),
    });
    if (!response.ok) throw new Error('Failed to refund investor');
    return response.json();
  }

  async withdrawFunds(productId: number, issuerUserId: string, amountE6: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/products/${productId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId, amountE6 }),
    });
    if (!response.ok) throw new Error('Failed to withdraw funds');
    return response.json();
  }

  // Investment
  async subscribe(userId: string, productId: number, amountE6: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/invest/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, productId, amountE6 }),
    });
    if (!response.ok) throw new Error('Failed to subscribe');
    return response.json();
  }

  // Dividends
  async declareDividend(issuerUserId: string, productId: number, amountE6: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/dividends/declare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId, productId, amountE6 }),
    });
    if (!response.ok) throw new Error('Failed to declare dividend');
    return response.json();
  }

  async claimDividend(userId: string, productId: number): Promise<any> {
    const response = await fetch(`${this.baseUrl}/dividends/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, productId }),
    });
    if (!response.ok) throw new Error('Failed to claim dividend');
    return response.json();
  }

  // Portfolio
  async getUserPortfolio(userId: string): Promise<{
    holdings: PortfolioHolding[];
    totalInvested: number;
    totalPendingDividends: number;
  }> {
    const response = await fetch(`${this.baseUrl}/portfolio/${userId}`);
    if (!response.ok) throw new Error('Failed to get portfolio');
    return response.json();
  }

  async getProductHolding(userId: string, productId: number): Promise<PortfolioHolding> {
    const response = await fetch(`${this.baseUrl}/portfolio/${userId}/product/${productId}`);
    if (!response.ok) throw new Error('Failed to get product holding');
    return response.json();
  }

  async getUSDCBalance(userId: string, role: 'investor' | 'issuer' = 'investor'): Promise<{ balance: string }> {
    const response = await fetch(`${this.baseUrl}/portfolio/${userId}/usdc-balance?role=${role}`);
    if (!response.ok) throw new Error('Failed to get USDC balance');
    return response.json();
  }
}

export const api = new HyperArcAPI();
