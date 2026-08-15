const MeterService = require('../services/MeterService');

test('request hashes are stable for the same validated payload', () => {
  const payload = {
    prompt: 'Hash me',
    input_tokens: 1,
    cached_input_tokens: 2,
    output_tokens: 3,
    reasoning_tokens: 4,
  };

  expect(MeterService.createRequestHash(payload)).toBe(MeterService.createRequestHash(payload));
  expect(MeterService.createRequestHash(payload)).not.toBe(
    MeterService.createRequestHash({ ...payload, prompt: 'Changed' })
  );
});

test('cached input tokens are cheaper than regular input tokens', () => {
  const regularCost = MeterService.calculateCost({ input_tokens: 1000 });
  const cachedCost = MeterService.calculateCost({ cached_input_tokens: 1000 });
  expect(cachedCost).toBeLessThan(regularCost);
});

test('reasoning tokens cost the same as output tokens', () => {
  const outputCost = MeterService.calculateCost({ output_tokens: 1000 });
  const reasoningCost = MeterService.calculateCost({ reasoning_tokens: 1000 });
  expect(reasoningCost).toBe(outputCost);
});
