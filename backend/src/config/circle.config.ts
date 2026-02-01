export const circleConfig = () => ({
  circle: {
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    apiBaseUrl: process.env.CIRCLE_API_BASE_URL || 'https://api.circle.com',
    walletApiBaseUrl: process.env.CIRCLE_WALLET_API_BASE_URL || 'https://api.circle.com/v1/w3s',
  },
});
