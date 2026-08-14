const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('stripe', () => {
  const mockSessionCreate = jest.fn().mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.test/session/cs_test_123',
  });

  const mockStripeInstance = {
    checkout: {
      sessions: {
        create: mockSessionCreate,
      },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  };

  const mockStripeFactory = jest.fn(() => mockStripeInstance);
  mockStripeFactory.mockSessionCreate = mockSessionCreate;
  return mockStripeFactory;
});

const app = require('../app');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const TEST_TENANT_ID = 5555;
const token = jwt.sign(
  { tenantId: TEST_TENANT_ID, email: 'checkout-test@example.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

beforeAll(async () => {
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, $2, $3, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (id) DO NOTHING
  `, [TEST_TENANT_ID, 'checkout-test@example.com', 'hash']);
});

afterAll(async () => {
  await db.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID]);
  await db.end();
});

test('creates a Stripe checkout session for the authenticated tenant', async () => {
  const response = await request(app)
    .post('/checkout/create-session')
    .set('Authorization', `Bearer ${token}`)
    .send({});

  expect(response.status).toBe(200);
  expect(response.body.session_id).toBe('cs_test_123');
  expect(response.body.url).toBe('https://checkout.stripe.test/session/cs_test_123');

  const stripe = require('stripe');
  expect(stripe.mockSessionCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'subscription',
      metadata: { tenant_id: TEST_TENANT_ID.toString() },
    })
  );
});