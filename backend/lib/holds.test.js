const test = require('node:test');
const assert = require('node:assert/strict');
const { isHoldBooking, isExpiredHold } = require('./holds');

const NOW = Date.parse('2026-11-09T08:00:00Z');
const hold = (o) => ({ status: 'pending', internal_note: '[GIỮ CHỖ TẠM THỜI] Giữ chỗ', created_at: new Date(NOW).toISOString(), ...o });

test('chỉ lịch pending có ghi chú giữ chỗ mới là giữ chỗ', () => {
  assert.equal(isHoldBooking(hold()), true);
  assert.equal(isHoldBooking(hold({ status: 'confirmed' })), false);
  assert.equal(isHoldBooking(hold({ internal_note: 'khác' })), false);
  assert.equal(isExpiredHold({ status: 'confirmed', created_at: '2000-01-01' }, NOW), false);
});

test('hạn lấy theo thứ tự: cột hold_expires_at → EXPIRES trong ghi chú → 10 phút sau khi tạo', () => {
  const past = new Date(NOW - 1000).toISOString();
  const future = new Date(NOW + 1000).toISOString();
  assert.equal(isExpiredHold(hold({ hold_expires_at: past, internal_note: `[GIỮ CHỖ TẠM THỜI] EXPIRES:${NOW + 60000}` }), NOW), true);
  assert.equal(isExpiredHold(hold({ hold_expires_at: future }), NOW), false);
  assert.equal(isExpiredHold(hold({ internal_note: `[GIỮ CHỖ TẠM THỜI] EXPIRES:${NOW - 1}` }), NOW), true);
  assert.equal(isExpiredHold(hold({ internal_note: `[GIỮ CHỖ TẠM THỜI] EXPIRES:${NOW + 1}` }), NOW), false);
  assert.equal(isExpiredHold(hold({ created_at: new Date(NOW - 11 * 60000).toISOString() }), NOW), true);
  assert.equal(isExpiredHold(hold({ created_at: new Date(NOW - 9 * 60000).toISOString() }), NOW), false);
});

test('dữ liệu hỏng (không có hạn, không có ngày tạo) → coi như hết hạn', () => {
  assert.equal(isExpiredHold(hold({ created_at: null }), NOW), true);
});
