// API Client for HyperArc Backend

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface Product {
  id: number;
  name: string;
  description: string;
  issuerAddress: string;
  priceE6: string;
  price: number;
  subscriptionPoolE6?: string;
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

export interface DetailedToken {
  token: {
    name: string;
    symbol: string;
    decimals: number;
    isNative: boolean;
    tokenAddress?: string;
  };
  amount: string;
  amountFormatted: string;
  updateDate: string;
}

export interface DetailedWalletBalance {
  userId: string;
  role: string;
  walletIds: string[];
  summary?: {
    totalUSDC?: number;
    totalUSDCE6?: string;
    chainsCount?: number;
    assetsCount?: number;
  };
  balancesByChain: Record<string, DetailedToken[]>;
  rawTokenBalances?: Array<{ token: any; amount: string; updateDate: string }>;
}

export interface ChainBalance {
  chain: string;
  domain: number;
  balanceE6: string;
  balanceUSDC: string;
}

export interface UnifiedUSDCBalance {
  userId: string;
  role: string;
  walletId: string;
  depositorAddress?: string;
  totalBalanceE6: string;
  totalBalanceUSDC: string;
  balancesByChain: ChainBalance[];
}

class HyperArcAPI {
  private baseUrl: string;
  private onUnauthorized?: () => void;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setUnauthorizedHandler(handler: () => void) {
    this.onUnauthorized = handler;
  }

  private async handleResponse(response: Response) {
    if (response.status === 401) {
      console.warn('JWT expired or invalid, triggering logout');
      if (this.onUnauthorized) {
        this.onUnauthorized();
      }
      throw new Error('Authentication expired. Please login again.');
    }
    return response;
  }

  // Authentication
  async getNonce(): Promise<string> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/auth/nonce`));
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
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    }));
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'SIWE verification failed');
    }
    return response.json();
  }

  async linkExternalWallet(message: string, signature: string, token: string): Promise<{
    success: boolean;
    address: string;
  }> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/auth/link-wallet`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message, signature }),
    }));
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to link wallet');
    }
    return response.json();
  }

  // Wallet Management
  async createWallet(userId: string, role: 'investor' | 'issuer' | 'admin' = 'investor', blockchains: string = 'ARC-TESTNET'): Promise<WalletInfo> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/wallets/${userId}?role=${role}&blockchains=${blockchains}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response.ok) throw new Error('Failed to create wallet');
    return response.json();
  }

  async getWallet(userId: string, role?: 'investor' | 'issuer' | 'admin'): Promise<WalletInfo | WalletInfo[]> {
    const url = role 
      ? `${this.baseUrl}/wallets/${userId}?role=${role}`
      : `${this.baseUrl}/wallets/${userId}`;
    const response = await this.handleResponse(await fetch(url));
    if (!response.ok) throw new Error('Failed to get wallet');
    return response.json();
  }

  async getWalletBalance(userId: string, role: 'investor' | 'issuer' = 'investor'): Promise<BalanceInfo> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/wallets/${userId}/balance?role=${role}`));
    if (!response.ok) throw new Error('Failed to get balance');
    return response.json();
  }

  // Detailed wallet balance (per-chain token lists) - returns USDC + other tokens
  async getDetailedWalletBalance(userId: string, role: 'investor' | 'issuer' = 'investor'): Promise<DetailedWalletBalance> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/wallets/${userId}/balance?role=${role}`));
    if (!response.ok) throw new Error('Failed to get detailed wallet balance');
    return response.json();
  }

  // Unified USDC balance across multiple chains (Circle unified endpoint)
  async getUnifiedUSDCBalance(userId: string, role: 'investor' | 'issuer' = 'investor', chains?: string): Promise<UnifiedUSDCBalance> {
    const url = `${this.baseUrl}/wallets/${userId}/balance/usdc?role=${role}` + (chains ? `&chains=${encodeURIComponent(chains)}` : '');
    const response = await this.handleResponse(await fetch(url));
    if (!response.ok) throw new Error('Failed to get unified USDC balance');
    return response.json();
  }

  async addBlockchainsToWallet(userId: string, role: 'investor' | 'issuer' | 'admin', blockchains: string): Promise<WalletInfo> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/wallets/${userId}/blockchains?role=${role}&blockchains=${blockchains}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!response.ok) throw new Error('Failed to add blockchains to wallet');
    return response.json();
  }

  // Gateway (Cross-chain Funding)
  async fundArcAddress(userId: string, sourceChain: string, amount: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/gateway/fund-arc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sourceChain, amount }),
    }));
    if (!response.ok) throw new Error('Failed to fund Arc address');
    return response.json();
  }

  async gatewayDeposit(userId: string, sourceChain: string, amount: number | string): Promise<any> {
    const url = `${this.baseUrl}/gateway/deposit`;
    const payload = { userId, sourceChain, amount };
    console.log('[api] gatewayDeposit ->', url, payload);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log('[api] gatewayDeposit response status:', response.status);

    const handled = await this.handleResponse(response);

    const text = await handled.text();
    try {
      const data = JSON.parse(text);
      console.log('[api] gatewayDeposit response json:', data);
      if (!response.ok) throw new Error(data?.message || 'Failed to deposit to gateway');
      return data;
    } catch (e) {
      console.log('[api] gatewayDeposit response text:', text);
      if (!response.ok) throw new Error(text || 'Failed to deposit to gateway');
      return text;
    }
  }

  async transferToArc(userId: string, sourceChain: string, amount: number | string, maxFee: string): Promise<any> {
    const url = `${this.baseUrl}/gateway/transfer-to-arc`;
    const payload = { userId, sourceChain, amount, maxFee };
    console.log('[api] transferToArc ->', url, payload);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log('[api] transferToArc response status:', response.status);

    const handled = await this.handleResponse(response);
    const text = await handled.text();
    try {
      const data = JSON.parse(text);
      console.log('[api] transferToArc response json:', data);
      if (!response.ok) throw new Error(data?.message || 'Failed to transfer to arc');
      return data;
    } catch (e) {
      console.log('[api] transferToArc response text:', text);
      if (!response.ok) throw new Error(text || 'Failed to transfer to arc');
      return text;
    }
  }

  async getGatewayTransactionStatus(txId: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/gateway/transactions/${txId}`));
    if (!response.ok) throw new Error('Failed to get gateway transaction status');
    return response.json();
  }

  // Products
  async listProducts(): Promise<Product[]> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products`));
    if (!response.ok) throw new Error('Failed to list products');
    const raws = await response.json();
    return (raws || []).map((r: any) => normalizeProduct(r));
  }

  async getPendingProducts(): Promise<Product[]> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/pending`));
    if (!response.ok) throw new Error('Failed to get pending products');
    const raws = await response.json();
    return (raws || []).map((r: any) => normalizeProduct(r));
  }

  async getProductDetails(productId: number): Promise<Product> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}`));
    if (!response.ok) throw new Error('Failed to get product details');
    const raw = await response.json();
    return normalizeProduct(raw);
  }

  async createProduct(productData: {
    name: string;
    description: string;
    issuerAddress: string;
    priceE6: string;
    metadataURI: string;
    issuerUserId: string;
  }): Promise<Product> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productData),
    }));
    if (!response.ok) throw new Error('Failed to create product');
    return response.json();
  }

  async approveProduct(productId: number, adminUserId: string): Promise<Product> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUserId }),
    }));
    if (!response.ok) throw new Error('Failed to approve product');
    return response.json();
  }

  async rejectProduct(productId: number, adminUserId: string, reason?: string): Promise<Product> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUserId, reason }),
    }));
    if (!response.ok) throw new Error('Failed to reject product');
    return response.json();
  }

  async deactivateProduct(productId: number, issuerUserId: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId }),
    }));
    if (!response.ok) throw new Error('Failed to deactivate product');
    return response.json();
  }

  async refundInvestor(productId: number, issuerUserId: string, investorAddress: string, units: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId, investorAddress, units }),
    }));
    if (!response.ok) throw new Error('Failed to refund investor');
    return response.json();
  }

  async withdrawFunds(productId: number, issuerUserId: string, amountE6: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId, amountE6 }),
    }));
    if (!response.ok) throw new Error('Failed to withdraw funds');
    return response.json();
  }

  async getProductTotalUnits(productId: number): Promise<{ totalUnits: number }> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/${productId}/total-units`));
    if (!response.ok) throw new Error('Failed to get product total units');
    return response.json();
  }

  async getTreasuryBalance(): Promise<{ balance: string; balanceUSD: number }> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/products/treasury/balance`));
    if (!response.ok) throw new Error('Failed to get treasury balance');
    return response.json();
  }

  // Investment
  async subscribe(userId: string, productId: number, amountE6: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/invest/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, productId, amountE6 }),
    }));
    if (!response.ok) throw new Error('Failed to subscribe');
    return response.json();
  }

  // Dividends
  async declareDividend(issuerUserId: string, productId: number, amountE6: string): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/dividends/declare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuerUserId, productId, amountE6 }),
    }));
    if (!response.ok) throw new Error('Failed to declare dividend');
    return response.json();
  }

  async claimDividend(userId: string, productId: number): Promise<any> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/dividends/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, productId }),
    }));
    if (!response.ok) throw new Error('Failed to claim dividend');
    return response.json();
  }

  // Portfolio
  async getUserPortfolio(userId: string): Promise<{
    holdings: PortfolioHolding[];
    totalInvested: number;
    totalPendingDividends: number;
  }> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/portfolio/${userId}`));
    if (!response.ok) throw new Error('Failed to get portfolio');
    return response.json();
  }

  async getProductHolding(userId: string, productId: number): Promise<PortfolioHolding> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/portfolio/${userId}/product/${productId}`));
    if (!response.ok) throw new Error('Failed to get product holding');
    return response.json();
  }

  async getUSDCBalance(userId: string, role: 'investor' | 'issuer' = 'investor'): Promise<{ balance: string }> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/portfolio/${userId}/usdc-balance?role=${role}`));
    if (!response.ok) throw new Error('Failed to get USDC balance');
    return response.json();
  }

  async getUSDCAllowance(userId: string, role: 'investor' | 'issuer' = 'investor'): Promise<{ allowance: string }> {
    const response = await this.handleResponse(await fetch(`${this.baseUrl}/portfolio/${userId}/usdc-allowance?role=${role}`));
    if (!response.ok) throw new Error('Failed to get USDC allowance');
    return response.json();
  }
}

export const api = new HyperArcAPI();

function normalizeProduct(raw: any): Product {
  const id = raw.productId ?? raw.id ?? 0;
  const priceE6 = String(raw.priceE6 ?? raw.priceE6 ?? raw.price_e6 ?? '0');
  const price = (() => {
    const n = Number(priceE6);
    if (!Number.isFinite(n)) return raw.price ?? 0;
    return n / 1_000_000;
  })();
  const issuerAddress = raw.issuer ?? raw.issuerAddress ?? raw.issuer_address ?? '';

  return {
    id,
    name: raw.name ?? raw.title ?? '',
    description: raw.description ?? '',
    issuerAddress,
    priceE6,
    price,
    subscriptionPoolE6: raw.subscriptionPoolE6 ?? raw.subscription_pool_e6 ?? raw.subscription_pool ?? undefined,
    metadataURI: raw.metadataURI ?? raw.metadataUri ?? raw.metadata_uri ?? '',
    contractAddress: raw.contractAddress ?? raw.contract_address,
    active: raw.active ?? false,
    status: raw.status ?? 'approved',
    createdAt: raw.createdAt ?? raw.created_at,
    totalUnits: raw.totalUnits ?? raw.total_units,
    soldUnits: raw.soldUnits ?? raw.sold_units,
    category: raw.category,
    apy: raw.apy,
  } as Product;
}
