'use client';

import { useState, useEffect, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import Link from 'next/link';
import { Space_Grotesk } from 'next/font/google';
import { api, Product, PortfolioHolding } from './api/client';
import { SiweMessage } from 'siwe';
import { BrowserProvider, getAddress, getDefaultProvider } from 'ethers';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] });

type UserRole = 'investor' | 'issuer';
type InvestorTab = 'products' | 'portfolio';
type IssuerTab = 'my-products' | 'create' | 'pending';

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on?: (event: string, handler: (...args: any[]) => void) => void;
      removeListener?: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}

type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
  pending?: boolean;
};

function PendingButton({
  onClick,
  pendingLabel = 'Pending...',
  pending,
  disabled,
  children,
  ...props
}: PendingButtonProps) {
  const [internalPending, setInternalPending] = useState(false);
  const isPending = pending ?? internalPending;

  const handleClick = async (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled || isPending) {
      e.preventDefault();
      return;
    }
    setInternalPending(true);
    try {
      await onClick?.(e);
    } finally {
      setInternalPending(false);
    }
  };

  return (
    <button
      {...props}
      onClick={onClick ? handleClick : undefined}
      disabled={disabled || isPending}
      aria-busy={isPending}
    >
      {isPending ? pendingLabel : children}
    </button>
  );
}

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
  const [productTotalUnits, setProductTotalUnits] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wallet connection state
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [metamaskAddress, setMetamaskAddress] = useState<string | null>(null);

  // ENS + network state
  const [ensName, setEnsName] = useState<string | null>(null);
  // ENS cache key
  const ENS_CACHE_KEY = 'ensName';

  const [circleWalletAddress, setCircleWalletAddress] = useState<string | null>(null);
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({});
  const [depositStatus, setDepositStatus] = useState<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
  const [depositMessages, setDepositMessages] = useState<Record<string, string>>({});
  const [subscribingStatus, setSubscribingStatus] = useState<Record<number, 'idle' | 'loading' | 'success' | 'error'>>({});
  const [subscribeMessages, setSubscribeMessages] = useState<Record<number, string>>({});
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [circleWalletInfo, setCircleWalletInfo] = useState<any>(null);
  const [chainUSDCBalances, setChainUSDCBalances] = useState<Record<string, any[]>>({});
  const [unifiedUSDCBalance, setUnifiedUSDCBalance] = useState<number | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authRole, setAuthRole] = useState<UserRole | null>(null);
  // Role-selection modal state for users without an existing account
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [modalSelectedRole, setModalSelectedRole] = useState<UserRole>('investor');
  const [modalUserIdInput, setModalUserIdInput] = useState<string>('');

  // Create product form state
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Real Estate',
    metadataURI: '',
  });

  // Setup automatic logout on JWT expiry
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      console.log('JWT expired, logging out automatically');
      localStorage.removeItem(ENS_CACHE_KEY);
      handleDisconnectWallet();
      alert('Your session has expired. Please login again.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore authentication state from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('authToken');
    const storedUserId = localStorage.getItem('userId');
    const storedRole = localStorage.getItem('userRole');
    const cachedEns = localStorage.getItem(ENS_CACHE_KEY);

    if (storedToken && storedUserId) {
      console.log('Restoring authentication state from localStorage');
      setAuthToken(storedToken);
      setUserId(storedUserId);
      setWalletConnected(true);
      if (storedRole === 'investor' || storedRole === 'issuer') {
        setAuthRole(storedRole as UserRole);
        setUserRole(storedRole as UserRole);
      }

      if (typeof window.ethereum !== 'undefined') {
        window.ethereum
          .request({ method: 'eth_accounts' })
          .then((accounts: string[]) => {
            if (accounts.length > 0) {
              const addr = getAddress(accounts[0]);
              setMetamaskAddress(addr);
              setWalletAddress(addr);
              if (cachedEns) setEnsName(cachedEns);
            }
          })
          .catch((err: Error) => console.error('Failed to get MetaMask accounts:', err));
      }
    }
  }, []);

  // Watch MetaMask account/network changes and refresh ENS + network info
  useEffect(() => {
    if (typeof window.ethereum === 'undefined') return;

    const provider = new BrowserProvider(window.ethereum);

    const refreshFromMetamask = async () => {
      try {
        if (!window.ethereum) return;
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });

        if (!accounts?.length) {
          setMetamaskAddress(null);
          setWalletAddress(null);
          setEnsName(null);
          return;
        }

        const addr = getAddress(accounts[0]);
        setMetamaskAddress(addr);
        setWalletAddress(addr);

        const net = await provider.getNetwork();

        // lookupAddress uses current provider network (follows MetaMask)
        try {
          const name = await provider.lookupAddress(addr);
          setEnsName(name ?? null);
          if (name) {
            localStorage.setItem(ENS_CACHE_KEY, name);
          } else {
            localStorage.removeItem(ENS_CACHE_KEY);
          }
        } catch {
          setEnsName(null);
          localStorage.removeItem(ENS_CACHE_KEY);
        }
      } catch {
        // ignore
      }
    };

    const onAccountsChanged = () => refreshFromMetamask();
    const onChainChanged = () => refreshFromMetamask();

    if (window.ethereum.on) {
      window.ethereum.on('accountsChanged', onAccountsChanged);
      window.ethereum.on('chainChanged', onChainChanged);
    }

    refreshFromMetamask();

    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', onAccountsChanged);
        window.ethereum.removeListener('chainChanged', onChainChanged);
      }
    };
  }, []);

  // Load data on component mount and role change
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, walletConnected, userId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load wallet balance and Circle wallet info only if user is authenticated
      if (walletConnected && userId) {
        let unifiedData: any = null;
        try {
          unifiedData = await api.getUnifiedUSDCBalance(userId, userRole);
          console.log('Unified USDC balance data:', unifiedData);
          const totalUnified = parseFloat(unifiedData?.totalBalanceUSDC ?? '0');
          setUnifiedUSDCBalance(Number.isFinite(totalUnified) ? totalUnified : 0);
        } catch (err) {
          console.error('Failed to fetch unified USDC balance', err);
          setUnifiedUSDCBalance(null);
        }

        // Load Circle wallet info with all addresses
        try {
          const walletInfo = await api.getWallet(userId, userRole);
          console.log('Raw wallet info from API:', walletInfo);
          setCircleWalletInfo(walletInfo);
          try {
            const detailed = await api.getDetailedWalletBalance(userId, userRole);
            console.log('Detailed wallet balances:', detailed);

            if (detailed?.summary?.totalUSDC !== undefined) {
              const parsed = Number(detailed.summary.totalUSDC);
              if (!Number.isNaN(parsed)) setWalletBalance(parsed);
            } else {
              
              const fallback = await api.getWalletBalance(userId, userRole);
              setWalletBalance(fallback?.balanceUSD || 0);
            }

            const usdcMap: Record<string, any[]> = {};
            if (detailed?.balancesByChain) {
              for (const [chain, entries] of Object.entries(detailed.balancesByChain)) {
                const usdcEntries = (entries || []).filter((e: any) =>
                  (e?.token?.symbol || '').toLowerCase() === 'usdc'
                );
                if (usdcEntries.length > 0) usdcMap[chain] = usdcEntries;
              }
            }
            setChainUSDCBalances(usdcMap);
          } catch (err) {
            console.error('Failed to fetch detailed wallet balances:', err);
            try {
              const fallback = await api.getWalletBalance(userId, userRole);
              setWalletBalance(fallback?.balanceUSD || 0);
            } catch (e) {
              console.error('Fallback wallet balance failed', e);
            }
          }
        } catch (err) {
          console.error('Failed to load Circle wallet info:', err);
        }
      } else {
        setWalletBalance(0);
        setCircleWalletInfo(null);
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

        // Fetch authoritative total units per product from backend
        try {
          const map: Record<number, number> = {};
          await Promise.all(
            (productsData || []).map(async (p: any) => {
              try {
                const res = await api.getProductTotalUnits(p.id);
                map[p.id] = Number(res?.totalUnits ?? p.totalUnits ?? 0);
              } catch (e) {
                map[p.id] = Number(p.totalUnits ?? 0);
              }
            }),
          );
          setProductTotalUnits(map);
        } catch (e) {
          // ignore; leave productTotalUnits empty
        }

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

  const handleGatewayDeposit = async (sourceChain: string) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }
    const raw = depositAmounts[sourceChain];
    const amount = Number(raw);
    if (!raw || Number.isNaN(amount) || amount <= 0) {
      alert('Please enter a valid deposit amount');
      return;
    }

    console.log('Starting gateway deposit', { userId, sourceChain, amount });
    setDepositStatus((s) => ({ ...s, [sourceChain]: 'loading' }));
    setDepositMessages((s) => ({ ...s, [sourceChain]: '' }));

    try {
      const data = await api.gatewayDeposit(userId, sourceChain, amount);
      console.log('gatewayDeposit result:', data);
      const msg = data?.txId ? `Tx: ${data.txId}` : 'Submitted';
      setDepositStatus((s) => ({ ...s, [sourceChain]: 'success' }));
      setDepositMessages((s) => ({ ...s, [sourceChain]: msg }));
      setDepositAmounts((s) => ({ ...s, [sourceChain]: '' }));
      await loadData();
    } catch (err) {
      console.error('gatewayDeposit error:', err);
      const message = err instanceof Error ? err.message : String(err);
      setDepositStatus((s) => ({ ...s, [sourceChain]: 'error' }));
      setDepositMessages((s) => ({ ...s, [sourceChain]: message }));
      alert(message);
    }
  };

  const handleSubscribe = async (productId: number, amount: number) => {
    if (!userId) {
      alert('Please connect your wallet first');
      return;
    }

    setSubscribingStatus((s) => ({ ...s, [productId]: 'loading' }));
    setSubscribeMessages((s) => ({ ...s, [productId]: '' }));

    try {
      const amountE6 = (amount * 1_000_000).toString();

      console.log('Starting transferToArc before subscribe', { userId, productId, amount });
      // call transferToArc with required body: { userId, sourceChain, amount, maxFee }
      const transfer = await api.transferToArc(userId, 'BASE-SEPOLIA', amount, '2010000');
      console.log('transferToArc response:', transfer);

      console.log('Calling subscribe', { userId, productId, amountE6 });
      const sub = await api.subscribe(userId, productId, amountE6);
      console.log('subscribe response:', sub);

      setSubscribingStatus((s) => ({ ...s, [productId]: 'success' }));
      setSubscribeMessages((s) => ({ ...s, [productId]: sub?.message || 'Purchased' }));
      await loadData();
    } catch (err) {
      console.error('subscribe flow error:', err);
      const message = err instanceof Error ? err.message : String(err);
      setSubscribingStatus((s) => ({ ...s, [productId]: 'error' }));
      setSubscribeMessages((s) => ({ ...s, [productId]: message }));
      alert(message);
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
    if (creatingProduct) return;
    setCreatingProduct(true);
    try {
      const priceE6 = (parseFloat(newProduct.price) * 1_000_000).toString();

      // Get issuer wallet address from circleWallet and normalize to a string address
      const wallet = (await api.getWallet(userId, 'issuer')) as any;
      let issuerAddress = '0x0000000000000000000000000000000000000000';
      try {
        const walletData = Array.isArray(wallet) ? wallet.find((w: any) => w.role === 'issuer') : wallet;
        if (walletData?.circleWallet) {
          const raw = Object.values(walletData.circleWallet)[0];
          if (typeof raw === 'string') issuerAddress = raw;
          else if (raw && typeof raw === 'object') issuerAddress = (raw as { address?: string }).address ?? Object.values(raw).find((v: any) => typeof v === 'string') ?? issuerAddress;
        } else if (wallet?.addresses && wallet.addresses[0]?.address) {
          issuerAddress = wallet.addresses[0].address;
        }
      } catch (e) {
        console.warn('Failed to parse issuer wallet address, using zero address', e);
      }

      await api.createProduct({
        name: newProduct.name,
        description: newProduct.description,
        issuerAddress,
        priceE6,
        metadataURI: newProduct.metadataURI?.trim() || `ipfs://metadata-${Date.now()}`,
        issuerUserId: userId,
      });

      alert('Product created and submitted for approval!');
      setNewProduct({ name: '', description: '', price: '', category: 'Real Estate', metadataURI: '' });
      loadData();
      setIssuerTab('pending');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create product');
    } finally {
      setCreatingProduct(false);
    }
  };

  const handleConnectWallet = async () => {
    setConnectingWallet(true);
    try {
      if (typeof window.ethereum === 'undefined') {
        throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
      }

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length === 0) {
        throw new Error('No accounts found. Please unlock MetaMask.');
      }

      const metamaskAddr = getAddress(accounts[0]);
      setMetamaskAddress(metamaskAddr);
      setWalletAddress(metamaskAddr);

      // Read network + ENS after connection (follows MetaMask network)
      const provider = new BrowserProvider(window.ethereum!);
      const net = await provider.getNetwork();

      try {
        const name = await provider.lookupAddress(metamaskAddr);
        setEnsName(name ?? null);
            if (name) {
              localStorage.setItem(ENS_CACHE_KEY, name);
            } else {
              localStorage.removeItem(ENS_CACHE_KEY);
            }
          } catch {
            setEnsName(null);
            localStorage.removeItem(ENS_CACHE_KEY);
      }

      // Perform SIWE authentication
      await handleSiweLogin(metamaskAddr);

      setWalletConnected(true);

      // Auto-create/get Circle wallet after MetaMask connection
      await handleGetCircleWallet();
    } catch (err) {
      console.error('MetaMask connection error:', err);
    } finally {
      setConnectingWallet(false);
    }
  };

  const handleSiweLogin = async (address: string) => {
    try {
      console.log('Starting SIWE login for address:', address);

      const nonce = await api.getNonce();
      console.log('Received nonce:', nonce);

      const message = new SiweMessage({
        domain: window.location.host,
        address: address,
        statement: 'Sign in with Ethereum to HyperArc',
        uri: window.location.origin,
        version: '1',
        chainId: 5042002,
        nonce: nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageString = message.prepareMessage();
      console.log('SIWE Message:', messageString);

      const provider = new BrowserProvider(window.ethereum!);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(messageString);
      console.log('Signature:', signature);

      const authResult = await api.verifySiwe(messageString, signature);
      console.log('SIWE login successful!', {
        userId: authResult.userId,
        role: authResult.role,
      });

      setAuthToken(authResult.accessToken);
      setAuthRole(authResult.role as UserRole);
      setUserId(authResult.userId);
      localStorage.setItem('authToken', authResult.accessToken);
      localStorage.setItem('userId', authResult.userId);
      localStorage.setItem('userRole', authResult.role);

      await loadData();
    } catch (err) {
      console.error('SIWE login error:', err);
      // On any SIWE verification failure, prompt the user to choose role and create a wallet
      try {
        const suggested = `user-${address.slice(2, 10)}`;
        setPendingUserId(suggested);
        setModalUserIdInput(suggested);
        setModalSelectedRole('investor');
        setShowRoleModal(true);
        return; // swallow error to allow user to choose role
      } catch (e) {
        // If something goes wrong creating suggestion, rethrow original error
      }
      throw err;
    }
  };

  const handleGetCircleWallet = async () => {
    if (!userId) {
      console.warn('No userId available, skipping Circle wallet fetch');
      return;
    }
    try {
      let wallet: any;
      try {
        wallet = await api.getWallet(userId, userRole);
        console.log('Existing Circle wallet:', wallet);
      } catch (err) {
        console.log('No existing Circle wallet found for user, prompting role selection:', userId, err);
        setShowRoleModal(true);
        return;
      }

      const walletData = Array.isArray(wallet) ? wallet.find((w: any) => w.role === userRole) : wallet;

      console.log('Circle wallet data:', walletData);

      if (walletData?.circleWallet) {
        const addressValues = Object.values(walletData.circleWallet);
        if (addressValues.length > 0) {
          const raw = addressValues[0];
          const address = typeof raw === 'string'
            ? raw
            : (raw && typeof raw === 'object' && 'address' in raw && typeof (raw as any).address === 'string'
                ? (raw as any).address
                : Object.values(raw || {}).find((v: any) => typeof v === 'string') ?? '');
          if (address) {
            setCircleWalletAddress(address);
            await loadData();
            console.log('Circle wallet address:', address);
          }
        }
      }
    } catch (err) {
      console.error('Circle wallet error:', err);
    }
  };

  // Create a Circle wallet for the user using the selected role (from modal)
  const createWalletForRole = async (role: UserRole, explicitUserId?: string) => {
    const targetUserId = explicitUserId || userId || pendingUserId || modalUserIdInput;
    if (!targetUserId) {
      alert('No userId available');
      return;
    }
    try {
      setShowRoleModal(false);

      // Choose blockchains based on role per request
      const chainParam = role === 'investor'
        ? 'ARC-TESTNET,ETH-SEPOLIA,BASE-SEPOLIA,AVAX-FUJI'
        : 'ARC-TESTNET';

      const external = metamaskAddress || undefined;
      const wallet = await api.createWallet(targetUserId, role, chainParam, external);
      setAuthRole(role);
      setUserRole(role);
      localStorage.setItem('userRole', role);
      // persist userId
      setUserId(targetUserId);
      localStorage.setItem('userId', targetUserId);

      const walletData = Array.isArray(wallet) ? wallet.find((w: any) => w.role === role) : wallet;
      if (walletData?.circleWallet) {
        const addressValues = Object.values(walletData.circleWallet);
        if (addressValues.length > 0) {
          const raw = addressValues[0];
          const address = typeof raw === 'string'
            ? raw
            : (raw && typeof raw === 'object' && 'address' in raw && typeof (raw as any).address === 'string'
                ? (raw as any).address
                : Object.values(raw || {}).find((v: any) => typeof v === 'string') ?? '');
          if (address) {
            setCircleWalletAddress(address);
            // After creation, reload data
            await loadData();
            console.log('Created and set Circle wallet address:', address);
            // If investor, require the user to reconnect their wallet to complete SIWE login
            if (role === 'investor' && metamaskAddress) {
              alert('Wallet created. Please reconnect your wallet to complete sign-in.');
              // Clear local connection state so user must reconnect and perform SIWE again
              handleDisconnectWallet();
              return;
            }
            return;
          }
        }
      }
      // If no circle wallet address found, still reload data
      await loadData();
    } catch (err) {
      console.error('Failed to create Circle wallet for role', role, err);
      alert(err instanceof Error ? err.message : 'Failed to create wallet');
    }
  };

  const handleDisconnectWallet = () => {
    setWalletConnected(false);
    setWalletAddress(null);
    setMetamaskAddress(null);
    setEnsName(null);
    setCircleWalletAddress(null);
    setUserId(null);
    setAuthToken(null);
    setAuthRole(null);
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('userRole');
    localStorage.removeItem(ENS_CACHE_KEY);
    loadData();
  };

  const displayWalletLabel = () => {
    if (!metamaskAddress) return '';
    return ensName ?? `${metamaskAddress.slice(0, 6)}...${metamaskAddress.slice(-4)}`;
  };

  const toMetadataUrl = (uri?: string) => {
    if (!uri) return undefined;
    try {
      if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
    } catch {}
    return uri;
  };

  return (
    <div className={`${spaceGrotesk.className} min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800`}>
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xl">H</span>
              </div>
              <div className="flex items-center gap-6">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  HyperArc
                </h1>
                <nav className="hidden md:flex items-center gap-4 text-sm">
                  <Link href="/" className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                    Home
                  </Link>
                  <Link href="/guide" className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                    Guide
                  </Link>
                </nav>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {/* Role Switch */}
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <PendingButton
                  onClick={() => setUserRole('investor')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    userRole === 'investor'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Investor
                </PendingButton>
                <PendingButton
                  onClick={() => setUserRole('issuer')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    userRole === 'issuer'
                      ? 'bg-white dark:bg-slate-700 text-purple-600 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  } ${!authRole || authRole !== 'issuer' ? 'opacity-90' : ''}`}
                >
                  SPV/Issuer {!authRole || authRole !== 'issuer' ? '🔒' : ''}
                </PendingButton>
              </div>

              <div className="flex items-center gap-3">
                {walletConnected && metamaskAddress ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <span className="text-lg">🦊</span>
                    <div className="text-left">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Connected</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {displayWalletLabel()}
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
                <PendingButton
                  onClick={handleDisconnectWallet}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors font-medium"
                >
                  Disconnect
                </PendingButton>
              ) : (
                <PendingButton
                  onClick={handleConnectWallet}
                  disabled={connectingWallet}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
                >
                  {connectingWallet ? 'Connecting...' : 'Connect Wallet'}
                </PendingButton>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Role selection modal shown when user has no existing account */}
      {showRoleModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Choose your role</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">We couldn't find an existing HyperArc account tied to this wallet. Please choose whether you'd like to register as an Investor or an Issuer (SPV).</p>
            <div className="space-y-4 mb-4">
              <div className="flex gap-3">
                <PendingButton
                  onClick={() => setModalSelectedRole('investor')}
                  className={`flex-1 py-3 rounded-md font-medium ${modalSelectedRole === 'investor' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                >
                  Investor
                </PendingButton>
                <PendingButton
                  onClick={() => setModalSelectedRole('issuer')}
                  className={`flex-1 py-3 rounded-md font-medium ${modalSelectedRole === 'issuer' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
                >
                  Issuer (SPV)
                </PendingButton>
              </div>

              <div>
                <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">User ID</label>
                <input
                  value={modalUserIdInput}
                  onChange={(e) => setModalUserIdInput(e.target.value)}
                  placeholder={pendingUserId ?? 'user-xxxxxx'}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">You can edit the generated userId before creating the wallet.</p>
              </div>

              <div className="flex justify-end gap-3">
                <PendingButton onClick={() => setShowRoleModal(false)} className="text-sm text-slate-600 dark:text-slate-400 hover:underline">Cancel</PendingButton>
                <PendingButton
                  onClick={() => createWalletForRole(modalSelectedRole, modalUserIdInput || pendingUserId || undefined)}
                  className="py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium"
                >
                  Create Wallet
                </PendingButton>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <PendingButton onClick={loadData} className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline">
              Try again
            </PendingButton>
          </div>
        )}

        {!loading && (
          <>
            <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-900/70 shadow-2xl mb-10">
              <div className="absolute inset-0">
                <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-gradient-to-br from-blue-400/35 to-purple-500/35 blur-3xl" />
                <div className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-gradient-to-tr from-emerald-300/25 to-cyan-400/25 blur-3xl" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_60%)] dark:bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.8),transparent_60%)]" />
              </div>
              <div className="relative p-8 md:p-12">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-300">
                      Tokenized Capital Infrastructure
                    </p>
                    <h2 className="mt-3 text-3xl md:text-5xl font-semibold text-slate-900 dark:text-white tracking-tight">
                      Turn real-world assets into investable digital shares
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm md:text-base text-slate-600 dark:text-slate-300">
                      HyperArc connects accredited investors and SPV issuers with compliant, on-chain capital flows and real-time USDC settlement.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <PendingButton
                      onClick={walletConnected ? undefined : handleConnectWallet}
                      disabled={connectingWallet}
                      className="px-5 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium shadow-md hover:from-blue-700 hover:to-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                    >
                      {walletConnected ? 'Wallet Connected' : (connectingWallet ? 'Connecting...' : 'Connect Wallet')}
                    </PendingButton>
                    <Link
                      href="/guide"
                      className="px-5 py-3 rounded-lg border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 transition-colors"
                    >
                      View Platform Guide
                    </Link>
                  </div>
                </div>
                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { title: 'On-Chain Transparency', desc: 'Every subscription is recorded on-chain with auditable fund flow.' },
                    { title: 'Unified USDC', desc: 'Circle Wallet consolidates multi-chain balances in one view.' },
                    { title: 'Instant Distributions', desc: 'Issuers can declare dividends and settle directly to investors.' },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/70 p-4 shadow-sm"
                    >
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            {/* Investor View */}
            {userRole === 'investor' && (
              <>
                {/* Investor Tabs */}
                <div className="flex gap-4 mb-8">
                  <PendingButton
                    onClick={() => setInvestorTab('products')}
                    className={`px-6 py-3 rounded-lg font-medium transition-all ${
                      investorTab === 'products'
                        ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    Investment Products
                  </PendingButton>
                  <PendingButton
                    onClick={() => walletConnected && setInvestorTab('portfolio')}
                    disabled={!walletConnected}
                    className={`px-6 py-3 rounded-lg font-medium transition-all ${
                      investorTab === 'portfolio'
                        ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-md'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                    } ${!walletConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    My Portfolio {!walletConnected && '🔒'}
                  </PendingButton>
                </div>

                {/* Investor Products Tab */}
                {investorTab === 'products' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {products
                      .filter((p) => p.status === 'approved')
                      .map((product) => (
                        <div
                          key={product.id}
                          className="bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-shadow p-6 border border-slate-200 dark:border-slate-700"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
                              {product.category || 'Investment'}
                            </span>
                            {product.apy && (
                              <span className="text-2xl font-bold text-green-600 dark:text-green-400">{product.apy}</span>
                            )}
                          </div>

                          <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">{product.name}</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">{product.description}</p>
                          {product.metadataURI && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                              Metadata: <a href={toMetadataUrl(product.metadataURI)} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-600 dark:text-blue-400 underline break-all">{product.metadataURI}</a>
                            </p>
                          )}

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

                          <PendingButton
                            onClick={() => {
                              if (!walletConnected) {
                                alert('Please connect your wallet to invest.');
                                return;
                              }
                              const amount = prompt('Enter amount in USDC to invest:');
                              if (amount) handleSubscribe(product.id, parseFloat(amount));
                            }}
                            disabled={!walletConnected || subscribingStatus[product.id] === 'loading'}
                            className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all"
                          >
                            {!walletConnected ? 'Connect Wallet to Invest 🔒' : (subscribingStatus[product.id] === 'loading' ? 'Purchasing...' : 'Subscribe Now')}
                          </PendingButton>
                          {subscribingStatus[product.id] === 'success' && (
                            <p className="text-sm text-green-700 dark:text-green-300 mt-2">{subscribeMessages[product.id] || 'Purchase complete'}</p>
                          )}
                          {subscribingStatus[product.id] === 'error' && (
                            <p className="text-sm text-red-700 dark:text-red-300 mt-2">{subscribeMessages[product.id]}</p>
                          )}
                        </div>
                      ))}
                    {products.filter((p) => p.status === 'approved').length === 0 && (
                      <div className="col-span-full text-center py-12 text-slate-500 dark:text-slate-400">
                        No products available yet
                      </div>
                    )}
                  </div>
                )}

                {/* Investor Portfolio Tab */}
                {investorTab === 'portfolio' && (
                  walletConnected ? (
                    <div className="space-y-6">
                      {/* Portfolio Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Invested</p>
                          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                            ${Number(
                              portfolio.reduce((sum, item) => {
                                const prod = products.find((p) => p.id === item.productId);
                                const unitPrice = prod ? Number(prod.price || 0) : 0;
                                return sum + Number(item.units || 0) * unitPrice;
                              }, 0),
                            ).toFixed(2)}
                          </p>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending Dividends</p>
                          <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                            ${Number(portfolio.reduce((sum, item) => sum + (Number(item.pendingDividend || 0) / 1_000_000), 0)).toFixed(2)}
                          </p>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Holdings</p>
                          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                            {portfolio.reduce((sum, item) => sum + Number(item.units || 0), 0)} units
                          </p>
                        </div>
                      </div>

                      {/* Circle Wallet Balance */}
                      {circleWalletInfo && (
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700">
                          <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                <span className="text-white font-bold text-lg">💳</span>
                              </div>
                              <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Circle Wallet</h2>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Multi-chain USDC Balance</p>
                              </div>
                            </div>
                          </div>
                          <div className="p-6">
                            <div className="mb-6">
                              <div className="mb-3">
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Unified USDC Balance</p>
                                <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                                  {unifiedUSDCBalance === null ? '—' : `$${unifiedUSDCBalance.toFixed(2)} USDC`}
                                </p>
                              </div>

                              <div className="mb-3">
                              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Total Balance</p>
                              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">${walletBalance.toFixed(2)} USDC</p>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Blockchain Addresses</p>
                              {circleWalletInfo.circleWallet && typeof circleWalletInfo.circleWallet === 'object' && (
                                <>
                                  {Object.entries(circleWalletInfo.circleWallet).map(([blockchain, address]: [string, any]) => {
                                    const actualAddress = typeof address === 'string'
                                      ? address
                                      : (address && typeof address === 'object'
                                          ? (address.address ?? Object.values(address).find((v: any) => typeof v === 'string') ?? '')
                                          : '');
                                    const usdcEntries = chainUSDCBalances[blockchain] || [];
                                    const usdcDisplay = usdcEntries.length > 0
                                      ? usdcEntries.map((u: any) => {
                                          const symbol = (u?.token?.symbol || '').toLowerCase();
                                          // Normalize USDC display to 6 decimals for UI clarity
                                          if (symbol.includes('usdc')) {
                                            return Number(u.amount).toFixed(6);
                                          }
                                          return u.amountFormatted;
                                        }).join(', ')
                                      : '0.00';
                                    return (
                                      <div
                                        key={blockchain}
                                        className="flex flex-col p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg"
                                      >
                                        <div className="flex items-center w-full">
                                        <div className="flex items-center gap-3 flex-1">
                                          <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                                            <span className="text-white text-xs font-bold">{blockchain.split('-')[0].substring(0, 2)}</span>
                                          </div>
                                          <div>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{blockchain}</p>
                                            <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                                              {actualAddress ? `${actualAddress.slice(0, 10)}...${actualAddress.slice(-8)}` : 'N/A'}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">USDC: <span className="font-semibold">{usdcDisplay}</span></p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 justify-end">
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={depositAmounts[blockchain] ?? ''}
                                            onChange={(e) => setDepositAmounts((s) => ({ ...s, [blockchain]: e.target.value }))}
                                            placeholder="Amount"
                                            className="w-28 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                                          />
                                          <PendingButton
                                            onClick={() => handleGatewayDeposit(blockchain)}
                                            disabled={depositStatus[blockchain] === 'loading'}
                                            className="px-3 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-md hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {depositStatus[blockchain] === 'loading' ? (
                                              <span className="flex items-center gap-2"><span className="animate-spin inline-block w-3 h-3 rounded-full border-b-2 border-current"/>Processing</span>
                                            ) : (
                                              'Deposit'
                                            )}
                                          </PendingButton>
                                          <PendingButton
                                            onClick={() => {
                                              if (actualAddress) {
                                                navigator.clipboard.writeText(actualAddress);
                                                alert('Address copied to clipboard!');
                                              }
                                            }}
                                            disabled={!actualAddress}
                                            className="px-3 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            Copy
                                          </PendingButton>
                                        </div>
                                        </div>
                                        <div className="w-full mt-2 text-right">
                                          {depositStatus[blockchain] === 'success' && (
                                            <p className="text-xs text-green-700 dark:text-green-300 inline">Completed: {depositMessages[blockchain]}</p>
                                          )}
                                          {depositStatus[blockchain] === 'error' && (
                                            <p className="text-xs text-red-700 dark:text-red-300 inline">Error: {depositMessages[blockchain]}</p>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                              {(!circleWalletInfo.circleWallet || Object.keys(circleWalletInfo.circleWallet).length === 0) && (
                                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No blockchain addresses found</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

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
                                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">{holding.productName}</h3>
                                  <p className="text-sm text-slate-500 dark:text-slate-400">Product ID: #{holding.productId}</p>
                                </div>
                                <PendingButton
                                  onClick={() => handleClaimDividend(holding.productId)}
                                  disabled={(Number(holding.pendingDividend || 0) === 0)}
                                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                  Claim Dividend
                                </PendingButton>
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
                                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{holding.units || 0}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">Pending Dividend</p>
                                  <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                                    ${(Number(holding.pendingDividend || 0) / 1_000_000).toFixed(2)}
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
                  ) : (
                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                      Please connect your wallet to view your portfolio.
                    </div>
                  )
                )}
              </>
            )}

            {/* Issuer/SPV View */}
            {userRole === 'issuer' && (
              <>
                {/* Issuer Tabs */}
                <div className="flex gap-4 mb-8">
                  <PendingButton
                    onClick={() => setIssuerTab('my-products')}
                    className={`px-6 py-3 rounded-lg font-medium transition-all ${
                      issuerTab === 'my-products'
                        ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    My Products
                  </PendingButton>
                  <PendingButton
                    onClick={() => setIssuerTab('create')}
                    disabled={!walletConnected || authRole !== 'issuer'}
                    className={`px-6 py-3 rounded-lg font-medium transition-all ${
                      issuerTab === 'create'
                        ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                    } ${(!walletConnected || authRole !== 'issuer') ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Create Product {(!walletConnected || authRole !== 'issuer') && '🔒'}
                  </PendingButton>
                  <PendingButton
                    onClick={() => setIssuerTab('pending')}
                    disabled={!walletConnected || authRole !== 'issuer'}
                    className={`px-6 py-3 rounded-lg font-medium transition-all ${
                      issuerTab === 'pending'
                        ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-md'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-800/50'
                    } ${(!walletConnected || authRole !== 'issuer') ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Pending Approval {(!walletConnected || authRole !== 'issuer') && '🔒'}
                  </PendingButton>
                </div>

                {/* My Products Tab */}
                {issuerTab === 'my-products' && (
                  <div className="space-y-6">
                    {products
                      .filter((p) => p.status === 'approved')
                      .map((product) => (
                        <div
                          key={product.id}
                          className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700"
                        >
                          <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">{product.name}</h3>
                                {product.metadataURI && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                                    Metadata: <a href={toMetadataUrl(product.metadataURI)} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-600 dark:text-blue-400 underline break-all">{product.metadataURI}</a>
                                  </p>
                                )}
                                <span
                                  className={`px-3 py-1 text-xs font-medium rounded-full ${
                                    product.active
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                  }`}
                                >
                                  {product.active ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <PendingButton
                                  onClick={() => {
                                    const amount = prompt('Enter dividend amount in USDC:');
                                    if (amount) handleDeclareDividend(product.id, parseFloat(amount));
                                  }}
                                  disabled={!walletConnected}
                                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                  Declare Dividend
                                </PendingButton>
                                {product.active ? (
                                  <PendingButton
                                    onClick={() => handleDeactivateProduct(product.id)}
                                    disabled={!walletConnected}
                                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                                  >
                                    Deactivate
                                  </PendingButton>
                                ) : (
                                  <PendingButton
                                    disabled={!walletConnected}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                                  >
                                    Refund Investors
                                  </PendingButton>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                              <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Units</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                                  {productTotalUnits[product.id] ?? product.totalUnits ?? 0}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Price per Unit</p>
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                  ${Number(product.price ?? 0).toFixed(2)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Raised</p>
                                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                                  ${((Number(productTotalUnits[product.id] ?? product.totalUnits ?? 0) * Number(product.price ?? 0))).toFixed(2)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Available to Withdraw</p>
                                <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                  ${(
                                    (() => {
                                      // Prefer on-chain subscriptionPoolE6 if available
                                      if (product.subscriptionPoolE6) {
                                        const n = Number(product.subscriptionPoolE6);
                                        if (Number.isFinite(n)) return (n / 1_000_000);
                                      }
                                      // Fallback: estimate from sold units * price
                                      return (Number(productTotalUnits[product.id] ?? product.totalUnits ?? 0) * Number(product.price ?? 0));
                                    })()
                                  ).toFixed(2)}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="p-6">
                            <PendingButton
                              onClick={() => {
                                const amount = prompt('Enter amount to withdraw in USDC:');
                                if (amount) handleWithdrawFunds(product.id, parseFloat(amount));
                              }}
                              disabled={!walletConnected}
                              className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all"
                            >
                              Withdraw Subscription Funds
                            </PendingButton>
                          </div>
                        </div>
                      ))}
                    {products.filter((p) => p.status === 'approved').length === 0 && (
                      <div className="text-center py-12 text-slate-500 dark:text-slate-400">No products created yet</div>
                    )}
                  </div>
                )}

                {/* Create Product Tab */}
                {issuerTab === 'create' && (
                  authRole !== 'issuer' ? (
                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">You are not authorized to create products.</div>
                  ) : !walletConnected ? (
                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">Please connect your wallet to create a product.</div>
                  ) : (
                    <div className="max-w-2xl mx-auto">
                      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Create New Product</h2>

                        <form onSubmit={handleCreateProduct} className="space-y-6">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Product Name</label>
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
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Description</label>
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
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Category</label>
                            <select
                              value={newProduct.category}
                              onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                              className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            >
                              <option>Real Estate</option>
                              <option>Venture Capital</option>
                              <option>Renewable Energy</option>
                              <option>Infrastructure</option>
                              <option>Private Credit</option>
                              <option>Technology</option>
                              <option>Other</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Price per Unit (USDC)</label>
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

                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Metadata URI (optional)</label>
                            <input
                              type="text"
                              value={newProduct.metadataURI}
                              onChange={(e) => setNewProduct({ ...newProduct, metadataURI: e.target.value })}
                              className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              placeholder="ipfs://..."
                            />
                          </div>

                          <PendingButton
                            type="submit"
                            pending={creatingProduct}
                            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg font-medium transition-all text-lg"
                          >
                            Submit for Approval
                          </PendingButton>

                          <p className="text-sm text-slate-500 dark:text-slate-400 text-center">Your product will be reviewed by the admin before being listed</p>
                        </form>
                      </div>
                    </div>
                  )
                )}

                {/* Pending Products Tab */}
                {issuerTab === 'pending' && (
                  authRole !== 'issuer' ? (
                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">You are not authorized to view pending products.</div>
                  ) : !walletConnected ? (
                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">Please connect your wallet to view pending products.</div>
                  ) : (
                    <div className="space-y-4">
                      {pendingProducts.map((product) => (
                        <div key={product.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{product.name}</h3>
                                <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs font-medium rounded-full">Pending Review</span>
                              </div>
                              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{product.description}</p>
                              {product.metadataURI && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Metadata: <a href={toMetadataUrl(product.metadataURI)} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-600 dark:text-blue-400 underline break-all">{product.metadataURI}</a></p>
                              )}
                            </div>
                            <div>
                              <span className="text-slate-500 dark:text-slate-400">Category: </span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{product.category || 'General'}</span>
                            </div>
                          </div>
                          <PendingButton className="px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-medium transition-colors">Cancel</PendingButton>
                        </div>
                      ))}
                      {pendingProducts.length === 0 && (<div className="text-center py-12 text-slate-500 dark:text-slate-400">No pending products</div>)}
                    </div>
                  )
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
