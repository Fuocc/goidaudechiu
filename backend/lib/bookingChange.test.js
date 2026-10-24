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

// --- Nhóm khách (#10): "Cả nhóm / Chỉ khách này" khi đổi ngày / giờ bắt đầu ---
// A (lịch đang sửa) 14:00–15:00, B 14:30–16:00 (90 phút), cùng nhóm g1
const groupA = (o = {}) => booking({ id: 'A', group_booking_id: 'g1', employee_id: 'eA', start_time: '14:00:00', end_time: '15:00:00', ...o });
const groupB = (o = {}) => booking({ id: 'B', group_booking_id: 'g1', employee_id: 'eB', bed_id: 'bed2', start_time: '14:30:00', end_time: '16:00:00', ...o });
const slotA = { service_id: 's1', branch_id: 'br1', employee_id: 'eA', start_time: '14:00', end_time: '15:00' };
const byId = (plan) => Object.fromEntries(plan.targets.map(t => [t.id, t]));

test('lịch thuộc nhóm đổi giờ bắt đầu hoặc ngày mà không gửi scope → hỏi (scopeRequired + số khách), không có kế hoạch ghi', () => {
  const time = planChange({ booking: groupA(), group: [groupB()], service: service(), change: { ...slotA, start_time: '16:00', end_time: '17:00' } });
  assert.equal(time.scopeRequired, true);
  assert.equal(time.groupSize, 2);
  assert.equal(time.targets, undefined);

  const date = planChange({ booking: groupA(), group: [groupB()], service: service(), change: { ...slotA, booking_date: '2026-11-10' } });
  assert.equal(date.scopeRequired, true);
});

test('lịch thuộc nhóm chỉ đổi NV / giờ kết thúc / ghi chú, không gửi scope → không hỏi, chỉ lịch này', () => {
  for (const c of [{ employee_id: 'e9' }, { end_time: '15:30' }, { notes: 'Mới' }]) {
    const plan = planChange({ booking: groupA(), group: [groupB()], service: service(), change: { ...slotA, ...c } });
    assert.equal(plan.scopeRequired, undefined, JSON.stringify(c));
    assert.equal(only(plan).id, 'A');
  }
});

test('Cả nhóm + đổi giờ: mọi khách cùng giờ bắt đầu mới, mỗi người giữ thời lượng của mình', () => {
  const plan = planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'group', change: { ...slotA, start_time: '16:00', end_time: '17:00' } });
  const t = byId(plan);
  assert.deepEqual(Object.keys(t).sort(), ['A', 'B']);
  assert.equal(t.A.set.start_time, '16:00');
  assert.equal(t.A.set.end_time, '17:00');
  assert.equal(t.B.set.start_time, '16:00');
  assert.equal(t.B.set.end_time, '17:30');
  assert.equal(t.B.placementChanged, true);
});

test('Cả nhóm + chỉ đổi ngày: mọi khách sang ngày mới, mỗi người giữ giờ bắt đầu của mình', () => {
  const t = byId(planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'group', change: { ...slotA, booking_date: '2026-11-10' } }));
  assert.equal(t.A.set.booking_date, '2026-11-10');
  assert.equal(t.B.set.booking_date, '2026-11-10');
  assert.equal(t.B.set.start_time.slice(0, 5), '14:30');
  assert.equal(t.B.set.end_time.slice(0, 5), '16:00');
});

test('khách đã hủy trong nhóm không bị dời và không tính vào số khách', () => {
  const cancelled = booking({ id: 'C', group_booking_id: 'g1', status: 'cancelled', start_time: '14:00:00', end_time: '15:00:00' });
  const ask = planChange({ booking: groupA(), group: [groupB(), cancelled], service: service(), change: { ...slotA, start_time: '16:00', end_time: '17:00' } });
  assert.equal(ask.groupSize, 2);

  const moved = byId(planChange({ booking: groupA(), group: [groupB(), cancelled], service: service(), scope: 'group', change: { ...slotA, start_time: '16:00', end_time: '17:00' } }));
  assert.deepEqual(Object.keys(moved).sort(), ['A', 'B']);

  // Nhóm chỉ còn 1 khách chưa hủy → như lịch lẻ, không hỏi
  const alone = planChange({ booking: groupA(), group: [cancelled], service: service(), change: { ...slotA, start_time: '16:00', end_time: '17:00' } });
  assert.equal(alone.scopeRequired, undefined);
});

test('kéo sang cột NV khác + đổi giờ, Cả nhóm → NV mới chỉ cho khách này, khách khác giữ NV của mình', () => {
  const t = byId(planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'group', change: { ...slotA, employee_id: 'e9', start_time: '16:00', end_time: '17:00' } }));
  assert.equal(t.A.set.employee_id, 'e9');
  assert.equal('employee_id' in t.B.set, false, 'không ghi đè NV của khách B');
});

test('Chỉ khách này → chỉ lịch này dời, khách khác giữ nguyên', () => {
  const plan = planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'booking', change: { ...slotA, start_time: '16:00', end_time: '17:00' } });
  assert.equal(only(plan).id, 'A');
  assert.equal(only(plan).set.start_time, '16:00');
});

test('Cả nhóm làm lịch của khách khác vượt qua nửa đêm → từ chối, không có kế hoạch ghi', () => {
  // A 60 phút dời sang 22:45 → A kết thúc 23:45, B (90 phút) sẽ kết thúc 00:15 hôm sau
  const plan = planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'group', change: { ...slotA, start_time: '22:45', end_time: '23:45' } });
  assert.ok(plan.refused, 'phải từ chối');
  assert.equal(plan.targets, undefined);
});
