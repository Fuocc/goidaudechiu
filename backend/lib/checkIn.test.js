const test = require('node:test');
const assert = require('node:assert/strict');
const { roundedVnTime } = require('./checkIn');

// Giờ VN = UTC+7 → 09:mm UTC là 16:mm VN
const at = (hhmm) => new Date(`2026-10-15T${hhmm}:00Z`);

test('làm tròn giờ check-in tới mốc 5 phút gần nhất', () => {
  assert.equal(roundedVnTime(at('09:00')), '16:00');
  assert.equal(roundedVnTime(at('09:01')), '16:00');
  assert.equal(roundedVnTime(at('09:02')), '16:00');
  assert.equal(roundedVnTime(at('09:03')), '16:05');
  assert.equal(roundedVnTime(at('09:58')), '17:00');
});

test('không vượt quá 23:55', () => {
  assert.equal(roundedVnTime(at('16:58')), '23:55');
});
