const PRICING = {
  input_token: 0.000003,
  cached_input_token: 0.0000015,
  output_token: 0.000015,
  reasoning_token: 0.000015,
};

const PLANS = {
  free: {
    name: 'free',
    api_calls_limit: 1000,
    ai_tokens_limit: 100000,
    stripe_price_id: null,
  },
  pro: {
    name: 'pro',
    api_calls_limit: 100000,
    ai_tokens_limit: 10000000,
    stripe_price_id: process.env.STRIPE_PRO_PRICE_ID || null,
  },
};

module.exports = { PRICING, PLANS };