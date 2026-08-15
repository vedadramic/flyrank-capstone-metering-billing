const PRICING_MICROCENTS = {
  input_token: 300,
  cached_input_token: 150,
  output_token: 1500,
  reasoning_token: 1500,
};

const MICROCENTS_PER_USD = 100000000;

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

module.exports = { MICROCENTS_PER_USD, PLANS, PRICING_MICROCENTS };
