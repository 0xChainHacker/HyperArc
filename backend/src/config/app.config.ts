export const appConfig = () => ({
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 3001,
  },
  arc: {
    rpcUrl: process.env.ARC_NETWORK_RPC_URL || 'https://rpc.testnet.arc.network',
    chainId: parseInt(process.env.ARC_CHAIN_ID, 10) || 5042002,
    ledgerAddress: process.env.ARC_LEDGER_CONTRACT_ADDRESS,
    distributorAddress: process.env.ARC_DISTRIBUTOR_CONTRACT_ADDRESS,
    usdcAddress: process.env.ARC_USDC_ADDRESS,
  },
});
