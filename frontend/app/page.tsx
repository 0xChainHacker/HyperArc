'use client';

import { useState } from 'react';

// Mock data for demonstration
const mockProducts = [
  {
    id: 1,
    name: 'Real Estate Fund A',
    description: 'Premium commercial real estate in NYC',
    issuer: '0x1234...5678',
    price: 10.00,
    totalUnits: 1000,
    soldUnits: 250,
    active: true,
    apy: '8.5%',
    category: 'Real Estate',
    status: 'approved'
  },
  {
    id: 2,
    name: 'Tech Startup Portfolio',
    description: 'Diversified early-stage tech investments',
    issuer: '0xabcd...ef01',
    price: 25.00,
    totalUnits: 500,
    soldUnits: 180,
    active: true,
    apy: '12.3%',
    category: 'Venture Capital',
    status: 'approved'
  },
  {
    id: 3,
    name: 'Green Energy Fund',
    description: 'Sustainable energy infrastructure projects',
    issuer: '0x9876...4321',
    price: 50.00,
    totalUnits: 200,
    soldUnits: 50,
    active: true,
    apy: '6.8%',
    category: 'Energy',
    status: 'pending'
  }
];

const mockInvestorPortfolio = [
  { productId: 1, productName: 'Real Estate Fund A', units: 5, pendingDividend: 0.50, invested: 50.00 },
  { productId: 2, productName: 'Tech Startup Portfolio', units: 2, pendingDividend: 1.20, invested: 50.00 }
];

const mockIssuerProducts = [
  { 
    id: 1, 
    name: 'Real Estate Fund A', 
    totalUnits: 1000, 
    soldUnits: 250, 
    totalRaised: 2500.00,
    active: true,
    pendingWithdrawal: 2500.00,
    status: 'approved'
  }
];

type UserRole = 'investor' | 'issuer';
type InvestorTab = 'products' | 'portfolio';
type IssuerTab = 'my-products' | 'create' | 'pending';

export default function Home() {
  const [userRole, setUserRole] = useState<UserRole>('investor');
  const [investorTab, setInvestorTab] = useState<InvestorTab>('products');
  const [issuerTab, setIssuerTab] = useState<IssuerTab>('my-products');
  const [walletBalance] = useState(1250.50);
  
  // Create product form state
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Real Estate'
  });

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

              <div className="text-right">
                <p className="text-xs text-slate-500 dark:text-slate-400">Wallet Balance</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  ${walletBalance.toFixed(2)} USDC
                </p>
              </div>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium">
                Connect Wallet
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                onClick={() => setInvestorTab('portfolio')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  investorTab === 'portfolio'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                }`}
              >
                My Portfolio
              </button>
            </div>

            {/* Investor Products Tab */}
            {investorTab === 'products' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {mockProducts.filter(p => p.status === 'approved').map((product) => (
                  <div
                    key={product.id}
                    className="bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-shadow p-6 border border-slate-200 dark:border-slate-700"
                  >
                <div className="flex justify-between items-start mb-4">
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
                    {product.category}
                  </span>
                  <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {product.apy}
                  </span>
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
                      ${product.price.toFixed(2)} USDC
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Available</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {product.totalUnits - product.soldUnits}/{product.totalUnits} units
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Issuer</span>
                    <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {product.issuer}
                    </span>
                  </div>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-4">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full"
                    style={{ width: `${(product.soldUnits / product.totalUnits) * 100}%` }}
                  />
                </div>

                    <button className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-medium transition-all">
                      Subscribe Now
                    </button>
                  </div>
                ))}
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
                  ${mockInvestorPortfolio.reduce((sum, item) => sum + item.invested, 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending Dividends</p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                  ${mockInvestorPortfolio.reduce((sum, item) => sum + item.pendingDividend, 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Holdings</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {mockInvestorPortfolio.reduce((sum, item) => sum + item.units, 0)} units
                </p>
              </div>
            </div>

            {/* Holdings List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">My Holdings</h2>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {mockInvestorPortfolio.map((holding) => (
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
                      <button className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                        Claim Dividend
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Invested</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          ${holding.invested.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Units Owned</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {holding.units}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Pending Dividend</p>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                          ${holding.pendingDividend.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
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
                onClick={() => setIssuerTab('create')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  issuerTab === 'create'
                    ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                }`}
              >
                Create Product
              </button>
              <button
                onClick={() => setIssuerTab('pending')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  issuerTab === 'pending'
                    ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                }`}
              >
                Pending Approval
              </button>
            </div>

            {/* My Products Tab */}
            {issuerTab === 'my-products' && (
              <div className="space-y-6">
                {mockIssuerProducts.map((product) => (
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
                          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                            Declare Dividend
                          </button>
                          {product.active ? (
                            <button className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors">
                              Deactivate
                            </button>
                          ) : (
                            <button className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">
                              Refund Investors
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Units</p>
                          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {product.totalUnits}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Sold Units</p>
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {product.soldUnits}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Raised</p>
                          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                            ${product.totalRaised.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Available to Withdraw</p>
                          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                            ${product.pendingWithdrawal.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-6">
                      <button className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg font-medium transition-all">
                        Withdraw Subscription Funds
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create Product Tab */}
            {issuerTab === 'create' && (
              <div className="max-w-2xl mx-auto">
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
                    Create New Product
                  </h2>

                  <form className="space-y-6">
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
                {mockProducts.filter(p => p.status === 'pending').map((product) => (
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
                              ${product.price.toFixed(2)} USDC
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Category: </span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {product.category}
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
                {mockProducts.filter(p => p.status === 'pending').length === 0 && (
                  <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                    No pending products
                  </div>
                )}
              </div>
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
