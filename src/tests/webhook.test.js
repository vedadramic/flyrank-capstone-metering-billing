const request = require('supertest');
const app = require('../app');
const db = require('../db');

test('rejects webhook with invalid signature', async () => {
  const response = await request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 'invalid-signature')
    .send('{"type":"checkout.session.completed"}');

  expect(response.status).toBe(400);
});

afterAll(async () => {
  await db.end();
});