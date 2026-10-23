const test = require('node:test');
const assert = require('node:assert/strict');
const { planChange } = require('./bookingChange');

// Lịch đang lưu trong DB (giờ dạng HH:MM:SS như Postgres trả về)
const booking = (o = {}) => ({
  id: 'bk1', service_id: 's1', branch_id: 'br1', employee_id: 'e1', bed_id: 'bed1',
  customer_id: 'c1', temporary_name: null, booking_date: '2026-11-09',
  start_time: '15:00:00', end_time: '16:00:00', total_price: 300000,
  notes: 'Ghi chú cũ', internal_note: null, status: 'confirmed', ...o
});
const service = (o = {}) => ({ id: 's1', duration_minutes: 60, price: 300000, ...o });
const only = (plan) => { assert.equal(plan.targets.length, 1); return plan.targets[0]; };

test('không gửi end_time → giờ kết thúc = giờ bắt đầu + thời lượng dịch vụ (dịch vụ không có thời lượng = 60 phút)', () => {
  const t = only(planChange({ booking: booking(), service: service({ duration_minutes: 90 }), change: { start_time: '15:00' } }));
  assert.equal(t.set.end_time, '16:30');

  const noLength = only(planChange({ booking: booking(), service: service({ duration_minutes: null }), change: { start_time: '17:15' } }));
  assert.equal(noLength.set.end_time, '18:15');
});

test('dashboard gửi end_time (kéo dài / rút ngắn trên lịch) → dùng đúng giờ đó, không tính lại theo dịch vụ', () => {
  const t = only(planChange({ booking: booking(), service: service({ duration_minutes: 60 }), change: { start_time: '15:00', end_time: '17:30' } }));
  assert.equal(t.set.end_time, '17:30');
});

// Dashboard luôn gửi lại NV / chi nhánh / dịch vụ / giờ hiện tại kèm thay đổi
const sameSlot = { service_id: 's1', branch_id: 'br1', employee_id: 'e1', start_time: '15:00', end_time: '16:00' };

test('chỉ sửa ghi chú → không đổi vị trí (không kiểm tra trùng), field không gửi giữ giá trị cũ', () => {
  const t = only(planChange({ booking: booking({ internal_note: 'Nội bộ', temporary_name: 'Chị Mia' }), service: service(), change: { ...sameSlot, notes: 'Dị ứng tinh dầu' } }));
  assert.equal(t.placementChanged, false);
  assert.equal(t.set.notes, 'Dị ứng tinh dầu');
  assert.equal(t.set.internal_note, 'Nội bộ');
  assert.equal(t.set.temporary_name, 'Chị Mia');
  assert.equal(t.set.customer_id, 'c1');
  assert.equal(t.set.booking_date, '2026-11-09');
  assert.equal(t.set.employee_id, 'e1');
});

test('đổi giờ / NV / chi nhánh / ngày / giờ kết thúc → đổi vị trí (phải qua booking engine)', () => {
  const changed = (c) => only(planChange({ booking: booking(), service: service(), change: { ...sameSlot, ...c } })).placementChanged;
  assert.equal(changed({ start_time: '15:30', end_time: '16:30' }), true, 'đổi giờ');
  assert.equal(changed({ employee_id: 'e2' }), true, 'đổi NV');
  assert.equal(changed({ employee_id: null }), true, 'bỏ NV (Chưa xếp NV)');
  assert.equal(changed({ branch_id: 'br2' }), true, 'đổi chi nhánh');
  assert.equal(changed({ booking_date: '2026-11-10' }), true, 'đổi ngày');
  assert.equal(changed({ end_time: '16:30' }), true, 'kéo dài');
  // Đổi sang dịch vụ dài hơn, không gửi end_time → giờ kết thúc tính lại, dài ra
  assert.equal(changed({ end_time: undefined, service_id: 's2' }), false, 'cùng thời lượng 60 phút → không đổi');
  const longer = only(planChange({ booking: booking(), service: service({ id: 's2', duration_minutes: 90 }), change: { ...sameSlot, end_time: undefined, service_id: 's2' } }));
  assert.equal(longer.placementChanged, true, 'dịch vụ dài hơn');
});

test('giờ lưu HH:MM:SS, dashboard gửi HH:MM cùng giờ → không coi là đổi vị trí', () => {
  const t = only(planChange({ booking: booking({ start_time: '09:30:00', end_time: '10:30:00' }), service: service(), change: { ...sameSlot, start_time: '09:30', end_time: '10:30' } }));
  assert.equal(t.placementChanged, false);
});

test('total_price = giá dịch vụ (dịch vụ không có giá = 0)', () => {
  const t = only(planChange({ booking: booking(), service: service({ id: 's2', price: 450000 }), change: { ...sameSlot, service_id: 's2' } }));
  assert.equal(t.set.total_price, 450000);
  const free = only(planChange({ booking: booking(), service: service({ price: null }), change: sameSlot }));
  assert.equal(free.set.total_price, 0);
});

test('field ngoài danh sách cho phép (giường, trạng thái, giá…) không được ghi', () => {
  const t = only(planChange({ booking: booking(), service: service(), change: { ...sameSlot, bed_id: 'bed9', status: 'completed', total_price: 1, num_guests: 5 } }));
  assert.equal('bed_id' in t.set, false);
  assert.equal('status' in t.set, false);
  assert.equal('num_guests' in t.set, false);
  assert.equal(t.set.total_price, 300000);
});
