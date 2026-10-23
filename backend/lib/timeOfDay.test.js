const test = require('node:test');
const assert = require('node:assert/strict');
const { toMinutes, toHHMM, endTime, vnToday } = require('./timeOfDay');

test('toMinutes: nhận cả HH:MM và HH:MM:SS (giờ lưu trong DB)', () => {
  assert.equal(toMinutes('15:30'), 930);
  assert.equal(toMinutes('15:30:00'), 930);
  assert.equal(toMinutes('00:00'), 0);
});

test('toHHMM: số phút → HH:MM có số 0 đứng trước', () => {
  assert.equal(toHHMM(9 * 60 + 5), '09:05');
  assert.equal(toHHMM(0), '00:00');
  assert.equal(toHHMM(23 * 60 + 59), '23:59');
});

test('endTime: giờ bắt đầu + thời lượng dịch vụ', () => {
  assert.equal(endTime('15:00', 90), '16:30');
  assert.equal(endTime('09:45:00', 60), '10:45');
});

test('vnToday: ngày theo giờ VN (UTC+7), sang ngày mới lúc 17:00 UTC', () => {
  assert.equal(vnToday(new Date('2026-10-23T16:59:00Z')), '2026-10-23');
  assert.equal(vnToday(new Date('2026-10-23T17:00:00Z')), '2026-10-24');
  assert.equal(vnToday(new Date('2026-12-31T20:00:00Z')), '2027-01-01');
});
