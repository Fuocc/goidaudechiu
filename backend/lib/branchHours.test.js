const test = require('node:test');
const assert = require('node:assert/strict');
const { branchDayHours } = require('./branchHours');

// 2026-10-24 là thứ Bảy, 2026-10-26 là thứ Hai
const hours = {
  Saturday: { isOpen: true, open: '09:00', close: '19:30' },
  Monday: { isOpen: true, open: '10:00', close: '21:00' },
  Sunday: { isOpen: false, open: '09:00', close: '20:00' }
};

test('lấy giờ theo thứ của ngày đặt; Last booking time = close (kể cả phút)', () => {
  assert.deepEqual(branchDayHours(hours, '2026-10-24'), { isOpen: true, open: '09:00', close: '19:30', lastBookingTime: '19:30' });
  assert.equal(branchDayHours(hours, '2026-10-26').lastBookingTime, '21:00');
});

test('ngày nghỉ (isOpen false / closed true) → isOpen false', () => {
  assert.equal(branchDayHours(hours, '2026-10-25').isOpen, false);
  assert.equal(branchDayHours({ Sunday: { closed: true } }, '2026-10-25').isOpen, false);
});

test('chi nhánh chưa cài giờ cho ngày đó → mặc định 08:00–20:00 (như dashboard)', () => {
  const fallback = { isOpen: true, open: '08:00', close: '20:00', lastBookingTime: '20:00' };
  assert.deepEqual(branchDayHours(null, '2026-10-24'), fallback);
  assert.deepEqual(branchDayHours(hours, '2026-10-27'), fallback);
  assert.deepEqual(branchDayHours({ Saturday: { isOpen: true } }, '2026-10-24'), fallback);
});
