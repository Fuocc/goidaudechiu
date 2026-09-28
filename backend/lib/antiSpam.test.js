const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVnPhone } = require('./antiSpam');

test('chuẩn hóa SĐT di động Việt Nam về dạng 0xxxxxxxxx', () => {
  assert.equal(normalizeVnPhone('0912345678'), '0912345678');
  assert.equal(normalizeVnPhone('0912 345 678'), '0912345678');
  assert.equal(normalizeVnPhone('091.234.5678'), '0912345678');
  assert.equal(normalizeVnPhone('+84 912 345 678'), '0912345678');
  assert.equal(normalizeVnPhone('84912345678'), '0912345678');
  assert.equal(normalizeVnPhone('(+84) 38-123-4567'), '0381234567');
});

test('từ chối số không phải di động Việt Nam', () => {
  assert.equal(normalizeVnPhone('12345678'), null);
  assert.equal(normalizeVnPhone('0000000000'), null);
  assert.equal(normalizeVnPhone('0212345678'), null);   // đầu số không phải di động
  assert.equal(normalizeVnPhone('091234567'), null);    // thiếu số
  assert.equal(normalizeVnPhone('09123456789'), null);  // thừa số
  assert.equal(normalizeVnPhone('abc'), null);
  assert.equal(normalizeVnPhone(undefined), null);
  assert.equal(normalizeVnPhone({}), null);
});
