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
    availableUnits: 750,
    apy: '8.5%',
    category: 'Real Estate'
  },
  {
    id: 2,
    name: 'Tech Startup Portfolio',
    description: 'Diversified early-stage tech investments',
    issuer: '0xabcd...ef01',
    price: 25.00,
    totalUnits: 500,
    availableUnits: 320,
    apy: '12.3%',
    category: 'Venture Capital'
  },
  {
    id: 3,
    name: 'Green Energy Fund',
    description: 'Sustainable energy infrastructure projects',
    issuer: '0x9876...4321',
    price: 50.00,
    totalUnits: 200,
    availableUnits: 150,
    apy: '6.8%',
    category: 'Energy'
  }
];

const mockPortfolio = [
  { productId: 1, productName: 'Real Estate Fund A', units: 5, pendingDividend: 0.50 },
  { productId: 2, productName: 'Tech Startup Portfolio', units: 2, pendingDividend: 1.20 }
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<'products' | 'portfolio'>('products');
  const [walletBalance] = useState(1250.50);

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
        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === 'products'
                ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
            }`}
          >
            Investment Products
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === 'portfolio'
                ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
            }`}
          >
            My Portfolio
          </button>
        </div>

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mockProducts.map((product) => (
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
                      {product.availableUnits}/{product.totalUnits} units
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
                    style={{ width: `${(product.availableUnits / product.totalUnits) * 100}%` }}
                  />
                </div>

                <button className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-medium transition-all">
                  Invest Now
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Portfolio Tab */}
        {activeTab === 'portfolio' && (
          <div className="space-y-6">
            {/* Portfolio Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Holdings</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {mockPortfolio.reduce((sum, item) => sum + item.units, 0)} units
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending Dividends</p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                  ${mockPortfolio.reduce((sum, item) => sum + item.pendingDividend, 0).toFixed(2)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Active Products</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {mockPortfolio.length}
                </p>
              </div>
            </div>

            {/* Holdings List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">My Holdings</h2>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {mockPortfolio.map((holding) => (
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
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Units Owned</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {holding.units}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Pending Dividend</p>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                          ${holding.pendingDividend.toFixed(2)} USDC
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
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
