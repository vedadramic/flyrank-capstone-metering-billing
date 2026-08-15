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

test.each([
  ['input', { input_tokens: 1 }, 300],
  ['cached input', { cached_input_tokens: 1 }, 150],
  ['output', { output_tokens: 1 }, 1500],
  ['reasoning', { reasoning_tokens: 1 }, 1500],
])('%s token pricing is pinned to exact integer microcents', (name, tokens, expected) => {
  expect(MeterService.calculateCost(tokens)).toBe(expected);
});

test('all token categories are added with integer math', () => {
  expect(MeterService.calculateCost({
    input_tokens: 1,
    cached_input_tokens: 1,
    output_tokens: 1,
    reasoning_tokens: 1,
  })).toBe(3450);
});
