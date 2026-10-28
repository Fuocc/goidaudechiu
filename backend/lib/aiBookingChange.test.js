const test = require('node:test');
const assert = require('node:assert/strict');
const { toBookingChange, guestChoice } = require('./aiBookingChange');

// Lịch đang lưu trong DB (giờ dạng HH:MM:SS như Postgres trả về)
const booking = (o = {}) => ({
  id: 'bk1', service_id: 's1', branch_id: 'br1', employee_id: 'e1', bed_id: 'bed1',
  booking_date: '2026-11-09', start_time: '15:00:00', end_time: '16:00:00',
  notes: 'Ghi chú cũ', status: 'confirmed', ...o
});

test('chỉ lấy field được phép từ tham số của model; field khác (giường, giá, giờ kết thúc, trạng thái…) bị bỏ', () => {
  const { change } = toBookingChange({
    booking_id: 'bk1', booking_date: '2026-11-10', start_time: '16:00', service_id: 's2', branch_id: 'br2',
    employee_id: 'e2', notes: 'Ghi chú mới',
    bed_id: 'bed9', total_price: 1, end_time: '23:00', status: 'cancelled', num_guests: 5,
    customer_id: 'c9', internal_note: 'x', temporary_name: 'y', confirm_token: 't', customer_name_hint: 'Mia'
  }, booking());
  assert.deepEqual(Object.keys(change).sort(), ['booking_date', 'branch_id', 'employee_id', 'notes', 'service_id', 'start_time']);
  assert.equal(change.booking_date, '2026-11-10');
  assert.equal(change.start_time, '16:00');
  assert.equal(change.service_id, 's2');
  assert.equal(change.branch_id, 'br2');
  assert.equal(change.employee_id, 'e2');
  assert.equal(change.notes, 'Ghi chú mới');
});

test('scope: không gửi hoặc giá trị lạ → group (cả nhóm); booking giữ nguyên', () => {
  assert.equal(toBookingChange({ booking_id: 'bk1' }, booking()).scope, 'group');
  assert.equal(toBookingChange({ booking_id: 'bk1', scope: 'all' }, booking()).scope, 'group');
  assert.equal(toBookingChange({ booking_id: 'bk1', scope: 'group' }, booking()).scope, 'group');
  assert.equal(toBookingChange({ booking_id: 'bk1', scope: 'booking' }, booking()).scope, 'booking');
});

test('không đổi dịch vụ → gửi end_time giữ đúng thời lượng đang đặt (lịch NV đã kéo dài không bị rút ngắn)', () => {
  // Lịch 60 phút đã được kéo dài thành 15:00–16:30
  const stretched = booking({ end_time: '16:30:00' });
  assert.equal(toBookingChange({ start_time: '17:00' }, stretched).change.end_time, '18:30', 'dời giờ');
  assert.equal(toBookingChange({ notes: 'Mới' }, stretched).change.end_time, '16:30', 'chỉ sửa ghi chú');
  assert.equal(toBookingChange({ booking_date: '2026-11-10' }, stretched).change.end_time, '16:30', 'chỉ đổi ngày');
});

test('đổi dịch vụ → không gửi end_time (module tính theo thời lượng dịch vụ mới)', () => {
  assert.equal(toBookingChange({ service_id: 's2', start_time: '17:00' }, booking({ end_time: '16:30:00' })).change.end_time, undefined);
});

// Khách trong nhóm, kèm tên NV / dịch vụ như khi đọc từ DB
const guest = (id, o = {}) => ({
  id, temporary_name: 'Miss Mia', status: 'confirmed', start_time: '15:00:00', end_time: '16:00:00',
  employees: { name: `NV ${id}` }, services: { name: 'Ý dễ chịu' }, ...o
});

test('chỉ 1 khách mà tên trùng khách khác trong nhóm (chưa xác nhận) → trả danh sách khách: NV / giờ / dịch vụ', () => {
  const a = guest('a');
  const b = guest('b', { temporary_name: 'miss  mia ', start_time: '15:30:00', services: { name: 'Combo 17' } });
  const guests = guestChoice({ booking: a, group: [b], scope: 'booking' });
  assert.deepEqual(guests, [
    { booking_id: 'a', name: 'Miss Mia', therapist: 'NV a', start_time: '15:00', service: 'Ý dễ chịu' },
    { booking_id: 'b', name: 'miss  mia ', therapist: 'NV b', start_time: '15:30', service: 'Combo 17' }
  ]);
});

test('không cần hỏi khách nào: cả nhóm, đã xác nhận, lịch lẻ, tên riêng, hoặc khách trùng tên đã hủy', () => {
  const a = guest('a');
  assert.equal(guestChoice({ booking: a, group: [guest('b')], scope: 'group' }), null, 'cả nhóm');
  assert.equal(guestChoice({ booking: a, group: [guest('b')], scope: 'booking', guestConfirmed: true }), null, 'đã xác nhận');
  assert.equal(guestChoice({ booking: a, group: [], scope: 'booking' }), null, 'lịch lẻ');
  assert.equal(guestChoice({ booking: guest('a', { temporary_name: 'Lan' }), group: [guest('b')], scope: 'booking' }), null, 'tên riêng');
  assert.equal(guestChoice({ booking: a, group: [guest('b', { status: 'cancelled' })], scope: 'booking' }), null, 'khách kia đã hủy');
});

test('tên lấy từ khách đặt khi lịch không có tên riêng; NV trống → "Chưa xếp NV"', () => {
  const a = guest('a', { temporary_name: null, customers: { name: 'Mia' } });
  const b = guest('b', { temporary_name: null, customers: { name: 'Mia' }, employees: null });
  const guests = guestChoice({ booking: a, group: [b], scope: 'booking' });
  assert.equal(guests[1].name, 'Mia');
  assert.equal(guests[1].therapist, 'Chưa xếp NV');
});
