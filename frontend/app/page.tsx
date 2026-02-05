'use client';

import { useState, useEffect } from 'react';
import { api, Product, PortfolioHolding } from './api/client';
import { SiweMessage } from 'siwe';
import { BrowserProvider, getAddress } from 'ethers';

type UserRole = 'investor' | 'issuer';
type InvestorTab = 'products' | 'portfolio';
type IssuerTab = 'my-products' | 'create' | 'pending';

export default function Home() {
  const [userRole, setUserRole] = useState<UserRole>('investor');
  const [investorTab, setInvestorTab] = useState<InvestorTab>('products');
  const [issuerTab, setIssuerTab] = useState<IssuerTab>('my-products');
  
  // User ID - obtained from SIWE authentication
  const [userId, setUserId] = useState<string | null>(null);
  
  // State for API data
  const [products, setProducts] = useState<Product[]>([]);
  const [pendingProducts, setPendingProducts] = useState<Product[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Wallet connection state
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [metamaskAddress, setMetamaskAddress] = useState<string | null>(null);
  const [circleWalletAddress, setCircleWalletAddress] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  
  // Create product form state
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Real Estate'
  });

  // Load data on component mount and role change
  useEffect(() => {
    loadData();
  }, [userRole]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load wallet balance only if user is authenticated
      if (walletConnected && userId) {
        const balanceData = await api.getWalletBalance(userId, userRole);
        setWalletBalance(balanceData?.balanceUSD || 0);
      } else {
        setWalletBalance(0);
      }

      if (userRole === 'investor') {
        // Load products for investors (public data)
        const productsData = await api.listProducts();
        setProducts(productsData);
        
        // Load portfolio only if authenticated
        if (walletConnected && userId) {
          const portfolioData = await api.getUserPortfolio(userId);
          setPortfolio(portfolioData.holdings);
        } else {
          setPortfolio([]);
        }
      } else {
        // Load products (public data)
        const productsData = await api.listProducts();
        setProducts(productsData);
        
        // Load pending products only if authenticated
        if (walletConnected && userId) {
          const pendingData = await api.getPendingProducts();
          setPendingProducts(pendingData);
        } else {
          setPendingProducts([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (productId: number, amount: number) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    try {
      const amountE6 = (amount * 1_000_000).toString();
      await api.subscribe(userId, productId, amountE6);
      alert('Subscription successful!');
      loadData(); // Reload data
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to subscribe');
    }
  };

  const handleClaimDividend = async (productId: number) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    try {
      await api.claimDividend(userId, productId);
      alert('Dividend claimed successfully!');
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to claim dividend');
    }
  };

  const handleDeclareDividend = async (productId: number, amount: number) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    try {
      const amountE6 = (amount * 1_000_000).toString();
      await api.declareDividend(userId, productId, amountE6);
      alert('Dividend declared successfully!');
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to declare dividend');
    }
  };

  const handleDeactivateProduct = async (productId: number) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    if (!confirm('Are you sure you want to deactivate this product?')) return;
    try {
      await api.deactivateProduct(productId, userId);
      alert('Product deactivated successfully!');
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate product');
    }
  };

  const handleWithdrawFunds = async (productId: number, amount: number) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    try {
      const amountE6 = (amount * 1_000_000).toString();
      await api.withdrawFunds(productId, userId, amountE6);
      alert('Funds withdrawn successfully!');
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to withdraw funds');
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    try {
      const priceE6 = (parseFloat(newProduct.price) * 1_000_000).toString();
      
      // Get issuer wallet address
      const wallet = await api.getWallet(userId, 'issuer') as any;
      const issuerAddress = wallet.addresses?.[0]?.address || '0x0000000000000000000000000000000000000000';
      
      await api.createProduct({
        name: newProduct.name,
        description: newProduct.description,
        issuerAddress,
        priceE6,
        metadataURI: `ipfs://metadata-${Date.now()}`, // Placeholder
        issuerUserId: userId,
      });
      
      alert('Product created and submitted for approval!');
      setNewProduct({ name: '', description: '', price: '', category: 'Real Estate' });
      loadData();
      setIssuerTab('pending');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create product');
    }
  };

  const handleConnectWallet = async () => {
    setConnectingWallet(true);
    try {
      // Check if MetaMask is installed
      if (typeof window.ethereum === 'undefined') {
        throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
      }

      // Request account access
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (accounts.length === 0) {
        throw new Error('No accounts found. Please unlock MetaMask.');
      }

      const metamaskAddr = getAddress(accounts[0]); // Convert to EIP-55 checksum format
      setMetamaskAddress(metamaskAddr);
      setWalletAddress(metamaskAddr);

      // Perform SIWE authentication
      await handleSiweLogin(metamaskAddr);

      setWalletConnected(true);

      // Auto-create/get Circle wallet after MetaMask connection
      await handleGetCircleWallet();
      
    } catch (err) {
      console.error('MetaMask connection error:', err);
      alert(err instanceof Error ? err.message : 'Failed to connect MetaMask');
    } finally {
      setConnectingWallet(false);
    }
  };

  const handleSiweLogin = async (address: string) => {
    try {
      console.log('Starting SIWE login for address:', address);

      // 1. Get nonce from backend
      const nonce = await api.getNonce();
      console.log('Received nonce:', nonce);

      // 2. Create SIWE message
      const message = new SiweMessage({
        domain: window.location.host,
        address: address,
        statement: 'Sign in with Ethereum to HyperArc',
        uri: window.location.origin,
        version: '1',
        chainId: 5042002,
        nonce: nonce,
        issuedAt: new Date().toISOString()
      });

      const messageString = message.prepareMessage();
      console.log('SIWE Message:', messageString);

      // 3. Sign message with MetaMask
      const provider = new BrowserProvider(window.ethereum!);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(messageString);
      console.log('Signature:', signature);

      // 4. Verify signature with backend (auto-creates wallet if needed)
      const authResult = await api.verifySiwe(messageString, signature);
      console.log('SIWE login successful!', { 
        userId: authResult.userId, 
        role: authResult.role 
      });
      
      // Store the JWT token and userId
      setAuthToken(authResult.accessToken);
      setUserId(authResult.userId);
      localStorage.setItem('authToken', authResult.accessToken);
      localStorage.setItem('userId', authResult.userId);
      
      alert(`Successfully logged in!\nUser ID: ${authResult.userId}\nRole: ${authResult.role}`);
      
      // Reload data with authenticated userId
      await loadData();
      
    } catch (err) {
      console.error('SIWE login error:', err);
      throw err;
    }
  };

  const handleGetCircleWallet = async () => {
    if (!userId) {
      console.warn('No userId available, skipping Circle wallet fetch');
      return;
    }
    try {
      // Try to get existing wallet first
      let wallet: any;
      try {
        wallet = await api.getWallet(userId, userRole);
        console.log('Existing Circle wallet:', wallet);
      } catch (err) {
        // If wallet doesn't exist, create one
        console.log('Creating new Circle wallet for user:', userId);
        wallet = await api.createWallet(userId, userRole, 'ARC-TESTNET,ARB-SEPOLIA,MATIC-AMOY,ETH-SEPOLIA');
        console.log('Created Circle wallet:', wallet);
      }
      
      // Handle both single wallet and array of wallets
      const walletData = Array.isArray(wallet) 
        ? wallet.find((w: any) => w.role === userRole) 
        : wallet;
      
      console.log('Circle wallet data:', walletData);
      
      // Addresses is an object like { 'ARC-TESTNET': '0x...' }
      if (walletData?.addresses) {
        const addressValues = Object.values(walletData.addresses);
        if (addressValues.length > 0) {
          const address = addressValues[0] as string;
          setCircleWalletAddress(address);
          
          // Reload data to get updated balance
          await loadData();
          
          console.log('Circle wallet address:', address);
        }
      }
    } catch (err) {
      console.error('Circle wallet error:', err);
    }
  };

  const handleDisconnectWallet = () => {
    setWalletConnected(false);
    setWalletAddress(null);
    setMetamaskAddress(null);
    setCircleWalletAddress(null);
    setUserId(null);
    setAuthToken(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    // Reload data to show public view
    loadData();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xl">H</span>
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                HyperArc
              </h1>
            </div>
            
            <div className="flex items-center gap-6">
              {/* Role Switch */}
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <button
                  onClick={() => setUserRole('investor')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    userRole === 'investor'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Investor
                </button>
                <button
                  onClick={() => setUserRole('issuer')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    userRole === 'issuer'
                      ? 'bg-white dark:bg-slate-700 text-purple-600 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  SPV/Issuer
                </button>
              </div>

              <div className="flex items-center gap-3">
                {walletConnected && metamaskAddress ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <span className="text-lg">🦊</span>
                    <div className="text-left">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Connected</p>
                      <p className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {metamaskAddress.slice(0, 6)}...{metamaskAddress.slice(-4)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Wallet Balance</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {loading ? '...' : `$${(walletBalance || 0).toFixed(2)} USDC`}
                    </p>
                  </div>
                )}
              </div>
              {walletConnected ? (
                <button 
                  onClick={handleDisconnectWallet}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors font-medium"
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  onClick={handleConnectWallet}
                  disabled={connectingWallet}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
                >
                  {connectingWallet ? 'Connecting...' : 'Connect Wallet'}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
            <button 
              onClick={loadData}
              className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && (
          <>
        {/* Investor View */}
        {userRole === 'investor' && (
          <>
            {/* Investor Tabs */}
            <div className="flex gap-4 mb-8">
              <button
                onClick={() => setInvestorTab('products')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  investorTab === 'products'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                }`}
              >
                Investment Products
              </button>
              <button
                onClick={() => walletConnected && setInvestorTab('portfolio')}
                disabled={!walletConnected}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  investorTab === 'portfolio'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                } ${!walletConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                My Portfolio {!walletConnected && '🔒'}
              </button>
            </div>

            {/* Investor Products Tab */}
            {investorTab === 'products' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.filter(p => p.status === 'approved').map((product) => (
                  <div
                    key={product.id}
                    className="bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-shadow p-6 border border-slate-200 dark:border-slate-700"
                  >
                <div className="flex justify-between items-start mb-4">
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
                    {product.category || 'Investment'}
                  </span>
                  {product.apy && (
                    <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {product.apy}
                    </span>
                  )}
                </div>
                
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                  {product.name}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-2">
                  {product.description}
                </p>
                
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Price per Unit</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      ${(product.price || 0).toFixed(2)} USDC
                    </span>
                  </div>
                  {product.totalUnits && product.soldUnits !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 dark:text-slate-400">Available</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {product.totalUnits - product.soldUnits}/{product.totalUnits} units
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Issuer</span>
                    <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {product.issuerAddress?.slice(0, 6)}...{product.issuerAddress?.slice(-4)}
                    </span>
                  </div>
                </div>

                {product.totalUnits && product.soldUnits !== undefined && (
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-4">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full"
                      style={{ width: `${(product.soldUnits / product.totalUnits) * 100}%` }}
                    />
                  </div>
                )}

                    <button 
                      onClick={() => {
                        const amount = prompt('Enter amount in USDC to invest:');
                        if (amount) handleSubscribe(product.id, parseFloat(amount));
                      }}
                      className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-medium transition-all"
                    >
                      Subscribe Now
                    </button>
                  </div>
                ))}
                {products.filter(p => p.status === 'approved').length === 0 && (
                  <div className="col-span-full text-center py-12 text-slate-500 dark:text-slate-400">
                    No products available yet
                  </div>
                )}
              </div>
            )}

            {/* Investor Portfolio Tab */}
            {investorTab === 'portfolio' && (
          <div className="space-y-6">
            {/* Portfolio Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Invested</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  ${Number(portfolio.reduce((sum, item) => sum + Number(item.invested || 0), 0)).toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending Dividends</p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                  ${Number(portfolio.reduce((sum, item) => sum + Number(item.pendingDividend || 0), 0)).toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Holdings</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {portfolio.reduce((sum, item) => sum + Number(item.units || 0), 0)} units
                </p>
              </div>
            </div>

            {/* Holdings List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">My Holdings</h2>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {portfolio.map((holding) => (
                  <div key={holding.productId} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
                          {holding.productName}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Product ID: #{holding.productId}
                        </p>
                      </div>
                      <button 
                        onClick={() => handleClaimDividend(holding.productId)}
                        disabled={holding.pendingDividend === 0}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Claim Dividend
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Invested</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          ${Number(holding.invested || 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Units Owned</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {holding.units || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Pending Dividend</p>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                          ${Number(holding.pendingDividend || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {portfolio.length === 0 && (
                  <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                    No holdings yet. Start investing in products!
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
          </>
        )}

        {/* Issuer/SPV View */}
        {userRole === 'issuer' && (
          <>
            {/* Issuer Tabs */}
            <div className="flex gap-4 mb-8">
              <button
                onClick={() => setIssuerTab('my-products')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  issuerTab === 'my-products'
                    ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                }`}
              >
                My Products
              </button>
              <button
                onClick={() => walletConnected && setIssuerTab('create')}
                disabled={!walletConnected}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  issuerTab === 'create'
                    ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                } ${!walletConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Create Product {!walletConnected && '🔒'}
              </button>
              <button
                onClick={() => walletConnected && setIssuerTab('pending')}
                disabled={!walletConnected}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  issuerTab === 'pending'
                    ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                } ${!walletConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Pending Approval {!walletConnected && '🔒'}
              </button>
            </div>

            {/* My Products Tab */}
            {issuerTab === 'my-products' && (
              <div className="space-y-6">
                {products.filter(p => p.status === 'approved').map((product) => (
                  <div key={product.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                            {product.name}
                          </h3>
                          <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                            product.active 
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          }`}>
                            {product.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              const amount = prompt('Enter dividend amount in USDC:');
                              if (amount) handleDeclareDividend(product.id, parseFloat(amount));
                            }}
                            disabled={!walletConnected}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                          >
                            Declare Dividend
                          </button>
                          {product.active ? (
                            <button 
                              onClick={() => handleDeactivateProduct(product.id)}
                              disabled={!walletConnected}
                              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button disabled={!walletConnected} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
                              Refund Investors
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Units</p>
                          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {walletConnected ? (product.totalUnits || 0) : 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Sold Units</p>
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {walletConnected ? (product.soldUnits || 0) : 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Raised</p>
                          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                            ${walletConnected ? ((product.soldUnits || 0) * (product.price || 0)).toFixed(2) : '0.00'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Available to Withdraw</p>
                          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                            ${walletConnected ? ((product.soldUnits || 0) * (product.price || 0)).toFixed(2) : '0.00'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-6">
                      <button 
                        onClick={() => {
                          const amount = prompt('Enter amount to withdraw in USDC:');
                          if (amount) handleWithdrawFunds(product.id, parseFloat(amount));
                        }}
                        disabled={!walletConnected}
                        className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all"
                      >
                        Withdraw Subscription Funds
                      </button>
                    </div>
                  </div>
                ))}
                {products.filter(p => p.status === 'approved').length === 0 && (
                  <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                    No products created yet
                  </div>
                )}
              </div>
            )}

            {/* Create Product Tab */}
            {issuerTab === 'create' && (
              <div className="max-w-2xl mx-auto">
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                    Create New Product
                  </h2>

                  <form onSubmit={handleCreateProduct} className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Product Name
                      </label>
                      <input
                        type="text"
                        value={newProduct.name}
                        onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        placeholder="e.g., Real Estate Fund A"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Description
                      </label>
                      <textarea
                        value={newProduct.description}
                        onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                        rows={4}
                        className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        placeholder="Describe your investment product..."
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Category
                      </label>
                      <select
                        value={newProduct.category}
                        onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option>Real Estate</option>
                        <option>Venture Capital</option>
                        <option>Energy</option>
                        <option>Infrastructure</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Price per Unit (USDC)
                      </label>
                      <input
                        type="number"
                        value={newProduct.price}
                        onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        placeholder="10.00"
                        step="0.01"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg font-medium transition-all text-lg"
                    >
                      Submit for Approval
                    </button>

                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                      Your product will be reviewed by the admin before being listed
                    </p>
                  </form>
                </div>
              </div>
            )}

            {/* Pending Products Tab */}
            {issuerTab === 'pending' && (
              <div className="space-y-4">
                {pendingProducts.map((product) => (
                  <div key={product.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                            {product.name}
                          </h3>
                          <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs font-medium rounded-full">
                            Pending Review
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                          {product.description}
                        </p>
                        <div className="flex gap-6 text-sm">
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Price: </span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              ${(product.price || 0).toFixed(2)} USDC
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Category: </span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {product.category || 'General'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button className="px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-medium transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
                {pendingProducts.length === 0 && (
                  <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                    No pending products
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-700 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-sm text-slate-500 dark:text-slate-400">
            <p>HyperArc © 2026 - Powered by Circle & Arc Network</p>
            <p className="mt-2">Tokenized Economic Interest Investment Platform</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
