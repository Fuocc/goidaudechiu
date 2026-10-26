const test = require('node:test');
const assert = require('node:assert/strict');
const { planChange, planStatusChange } = require('./bookingChange');

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

test('lịch thuộc nhóm chỉ đổi NV / giờ kết thúc, không gửi scope → không hỏi, chỉ lịch này', () => {
  for (const c of [{ employee_id: 'e9' }, { end_time: '15:30' }]) {
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


// --- Check-in (#14): một khách hoặc cả nhóm ---
const { planCheckIn } = require('./bookingChange');
// Dòng check-in đọc kèm thời lượng dịch vụ: A 60 phút, B 90 phút
const arriving = (o = {}) => ({ ...groupA(), services: { duration_minutes: 60 }, ...o });
const friend = (o = {}) => ({ ...groupB(), services: { duration_minutes: 90 }, ...o });
const checkInTargets = (plan) => Object.fromEntries(plan.targets.map(t => [t.id, t]));

test('check-in lịch thuộc nhóm mà không gửi scope → hỏi (scopeRequired + số khách), không có kế hoạch ghi', () => {
  const plan = planCheckIn({ booking: arriving(), group: [friend()], start: '17:05' });
  assert.equal(plan.scopeRequired, true);
  assert.equal(plan.groupSize, 2);
  assert.equal(plan.targets, undefined);
});

test('check-in Chỉ khách này → chỉ khách này bắt đầu từ "bây giờ", khách khác không có trong kế hoạch', () => {
  const plan = planCheckIn({ booking: arriving(), group: [friend()], scope: 'booking', start: '17:05' });
  assert.deepEqual(plan.targets, [{ id: 'A', start: '17:05', end: '18:05' }]);
});

test('check-in Cả nhóm → mọi khách chưa hủy bắt đầu từ "bây giờ", mỗi người giữ thời lượng dịch vụ của mình', () => {
  const cancelled = friend({ id: 'C', status: 'cancelled' });
  const t = checkInTargets(planCheckIn({ booking: arriving(), group: [friend(), cancelled], scope: 'group', start: '17:05' }));
  assert.deepEqual(Object.keys(t).sort(), ['A', 'B']);
  assert.deepEqual(t.A, { id: 'A', start: '17:05', end: '18:05' });
  assert.deepEqual(t.B, { id: 'B', start: '17:05', end: '18:35' });
});

test('check-in lịch lẻ, hoặc nhóm mà khách khác đã hủy hết → không hỏi, chỉ lịch này', () => {
  const solo = planCheckIn({ booking: arriving({ group_booking_id: null }), start: '17:05' });
  assert.deepEqual(solo.targets.map(t => t.id), ['A']);
  const alone = planCheckIn({ booking: arriving(), group: [friend({ status: 'cancelled' })], start: '17:05' });
  assert.deepEqual(alone.targets.map(t => t.id), ['A']);
});

test('check-in: dịch vụ không có thời lượng → 60 phút', () => {
  const plan = planCheckIn({ booking: arriving({ services: null }), start: '17:05' });
  assert.equal(plan.targets[0].end, '18:05');
});

// --- #12: các field áp cho cả nhóm khác (dịch vụ, chi nhánh, ghi chú, ghi chú nội bộ, khách đặt) ---
test('lịch thuộc nhóm đổi dịch vụ / chi nhánh / ghi chú / ghi chú nội bộ / khách đặt mà không gửi scope → hỏi', () => {
  const cases = [
    { service_id: 's2' }, { branch_id: 'br2' }, { notes: 'Mới' }, { internal_note: 'Nội bộ mới' },
    { customer_id: 'c2' }, { customer_id: null, temporary_name: 'Chị Lan' },
    { customer_update: { name: 'Mia Nguyễn', phone: '0900000000' } }
  ];
  for (const c of cases) {
    const plan = planChange({ booking: groupA(), group: [groupB()], service: service(), change: { ...slotA, ...c } });
    assert.equal(plan.scopeRequired, true, JSON.stringify(c));
    assert.equal(plan.groupSize, 2);
  }
});

test('dashboard gửi lại giá trị cũ (ghi chú trống "" thay cho null…) hoặc chỉ đổi NV → không hỏi', () => {
  const walkIn = groupA({ customer_id: null, temporary_name: 'Chị Mia', notes: null, internal_note: null });
  const resent = { ...slotA, notes: '', internal_note: '', customer_id: null, temporary_name: 'Chị Mia' };
  for (const c of [{}, { employee_id: 'e9' }]) {
    const plan = planChange({ booking: walkIn, group: [groupB()], service: service(), change: { ...resent, ...c } });
    assert.equal(plan.scopeRequired, undefined, JSON.stringify(c));
    assert.equal(only(plan).id, 'A');
  }
});

test('Cả nhóm + đổi ghi chú / ghi chú nội bộ → ghi đè đúng nội dung mới cho mọi khách chưa hủy, không đổi vị trí', () => {
  const cancelled = booking({ id: 'C', group_booking_id: 'g1', status: 'cancelled' });
  const t = byId(planChange({
    booking: groupA(), group: [groupB({ notes: 'Ghi chú riêng của B' }), cancelled], service: service(), scope: 'group',
    change: { ...slotA, notes: 'Cả nhóm dị ứng tinh dầu', internal_note: 'Khách quen' }
  }));
  assert.deepEqual(Object.keys(t).sort(), ['A', 'B']);
  for (const id of ['A', 'B']) {
    assert.equal(t[id].set.notes, 'Cả nhóm dị ứng tinh dầu', id);
    assert.equal(t[id].set.internal_note, 'Khách quen', id);
    assert.equal(t[id].placementChanged, false, id);
  }
  assert.equal('start_time' in t.B.set, false, 'không đụng giờ của B');
});

test('Chỉ khách này + đổi ghi chú → chỉ lịch này', () => {
  const plan = planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'booking', change: { ...slotA, notes: 'Chỉ A' } });
  assert.equal(only(plan).set.notes, 'Chỉ A');
});

test('Cả nhóm + đổi dịch vụ → mọi khách dịch vụ mới + giá mới, giờ kết thúc = giờ bắt đầu của từng người + thời lượng mới', () => {
  const s2 = service({ id: 's2', duration_minutes: 120, price: 500000 });
  const t = byId(planChange({ booking: groupA(), group: [groupB()], service: s2, scope: 'group', change: { ...slotA, service_id: 's2', end_time: '16:00' } }));
  assert.equal(t.B.set.service_id, 's2');
  assert.equal(t.B.set.total_price, 500000);
  assert.equal('start_time' in t.B.set, false, 'B giữ giờ bắt đầu 14:30');
  assert.equal(t.B.set.end_time, '16:30');
  assert.equal(t.B.placementChanged, true, 'dài hơn → qua booking engine');
});

test('Cả nhóm + đổi dịch vụ + giờ → cùng giờ bắt đầu mới, kết thúc theo thời lượng dịch vụ mới', () => {
  const s2 = service({ id: 's2', duration_minutes: 120, price: 500000 });
  const t = byId(planChange({ booking: groupA(), group: [groupB()], service: s2, scope: 'group', change: { ...slotA, service_id: 's2', start_time: '16:00', end_time: '18:00' } }));
  assert.equal(t.B.set.start_time, '16:00');
  assert.equal(t.B.set.end_time, '18:00');
});

test('Cả nhóm + đổi dịch vụ cùng thời lượng với lịch của khách khác → khách đó không đổi vị trí', () => {
  // B đang 14:30–16:00 (90 phút); dịch vụ mới 90 phút
  const s2 = service({ id: 's2', duration_minutes: 90 });
  const t = byId(planChange({ booking: groupA(), group: [groupB()], service: s2, scope: 'group', change: { ...slotA, service_id: 's2', end_time: '15:30' } }));
  assert.equal(t.B.set.service_id, 's2');
  assert.equal(t.B.placementChanged, false);
});

test('Cả nhóm + đổi chi nhánh → mọi khách sang chi nhánh mới, đều qua booking engine (xếp lại NV + giường)', () => {
  const t = byId(planChange({ booking: groupA(), group: [groupB()], service: service(), scope: 'group', change: { ...slotA, branch_id: 'br2' } }));
  assert.equal(t.A.set.branch_id, 'br2');
  assert.equal(t.B.set.branch_id, 'br2');
  assert.equal(t.B.placementChanged, true);
  assert.equal('employee_id' in t.B.set, false, 'NV của B do booking engine quyết định');
});

// Khách đặt (Contact) của nhóm: hồ sơ khách c1 "Miss Mia", mọi khách trong nhóm cùng customer_id c1
const mia = { id: 'c1', name: 'Miss Mia', phone: '0901111111', email: null, habits: null };
const miaUpdate = (o = {}) => ({ name: 'Miss Mia', phone: '0901111111', email: '', habits: '', ...o });

test('Cả nhóm + đổi khách đặt → mọi khách cùng khách đặt mới; sửa hồ sơ khách đặt 1 lần', () => {
  const linked = byId(planChange({ booking: groupA(), group: [groupB({ customer_id: null, temporary_name: 'Tên riêng của B' })], service: service(), scope: 'group', change: { ...slotA, customer_id: 'c2', temporary_name: null } }));
  assert.equal(linked.B.set.customer_id, 'c2');
  assert.equal(linked.B.set.temporary_name, null, 'B về lại khách đặt chung');

  const plan = planChange({ booking: groupA(), customer: mia, group: [groupB()], service: service(), scope: 'group', change: { ...slotA, customer_update: miaUpdate({ phone: '0902222222' }) } });
  assert.deepEqual(plan.customerUpdate, { id: 'c1', data: { name: 'Miss Mia', phone: '0902222222', email: '', habits: null } });
  // ROADMAP › Contact (24/10): chỉ sửa SĐT → không gắn lại khách, hồ sơ chung đã đủ
  assert.equal('customer_id' in byId(plan).B.set, false);
});

test('Chỉ khách này + đổi tên → khách này có tên riêng (tách khỏi khách đặt), hồ sơ khách đặt giữ nguyên', () => {
  const plan = planChange({ booking: groupA(), customer: mia, group: [groupB()], service: service(), scope: 'booking', change: { ...slotA, customer_update: miaUpdate({ name: 'Chị Lan' }) } });
  const t = only(plan);
  assert.equal(t.set.customer_id, null);
  assert.equal(t.set.temporary_name, 'Chị Lan');
  assert.equal(plan.customerUpdate, null, 'không sửa hồ sơ Miss Mia');
});

test('Chỉ khách này + đổi SĐT / email / thói quen của khách đặt chung → từ chối (là thông tin của cả nhóm)', () => {
  for (const o of [{ phone: '0902222222' }, { email: 'mia@x.vn' }, { habits: 'Thích nhẹ tay' }, { name: 'Chị Lan', phone: '0902222222' }]) {
    const plan = planChange({ booking: groupA(), customer: mia, group: [groupB()], service: service(), scope: 'booking', change: { ...slotA, customer_update: miaUpdate(o) } });
    assert.ok(plan.refused, JSON.stringify(o));
  }
});

test('lịch lẻ + sửa hồ sơ khách → sửa hồ sơ như cũ', () => {
  const plan = planChange({ booking: booking(), customer: mia, service: service(), change: { ...sameSlot, customer_update: miaUpdate({ name: 'Mia Nguyễn' }) } });
  assert.equal(plan.customerUpdate.data.name, 'Mia Nguyễn');
  assert.equal(only(plan).set.customer_id, 'c1');
});

test('Cả nhóm chỉ đổi ghi chú → ghi chú nội bộ của khách khác giữ nguyên; chỉ đổi ghi chú nội bộ → ghi chú của khách khác giữ nguyên', () => {
  const a = groupA({ notes: 'Ghi chú A', internal_note: 'Cảnh báo spam A' });
  const b = groupB({ notes: 'Ghi chú riêng B', internal_note: 'Nội bộ B' });
  const notesOnly = byId(planChange({ booking: a, group: [b], service: service(), scope: 'group', change: { ...slotA, notes: 'Mới cho cả nhóm' } }));
  assert.equal(notesOnly.B.set.notes, 'Mới cho cả nhóm');
  assert.equal('internal_note' in notesOnly.B.set, false, 'không chép ghi chú nội bộ của A sang B');

  const internalOnly = byId(planChange({ booking: a, group: [b], service: service(), scope: 'group', change: { ...slotA, notes: 'Ghi chú A', internal_note: null } }));
  assert.equal(internalOnly.B.set.internal_note, null);
  assert.equal('notes' in internalOnly.B.set, false, 'không chép ghi chú của A sang B');
});

test('Cả nhóm chỉ sửa SĐT / email / thói quen của khách đặt → sửa hồ sơ, khách có tên riêng giữ tên riêng', () => {
  const lan = groupB({ customer_id: null, temporary_name: 'Chị Lan' });
  const plan = planChange({ booking: groupA(), customer: mia, group: [lan], service: service(), scope: 'group', change: { ...slotA, customer_update: miaUpdate({ phone: '0902222222' }) } });
  assert.equal(plan.customerUpdate.data.phone, '0902222222');
  const b = byId(plan).B;
  assert.equal('customer_id' in b.set, false, 'Chị Lan không bị gắn lại vào khách đặt');
  assert.equal('temporary_name' in b.set, false);
});

test('Cả nhóm đổi tên khách đặt → mọi khách gắn lại khách đặt, kể cả khách có tên riêng', () => {
  const lan = groupB({ customer_id: null, temporary_name: 'Chị Lan' });
  const plan = planChange({ booking: groupA(), customer: mia, group: [lan], service: service(), scope: 'group', change: { ...slotA, customer_update: miaUpdate({ name: 'Mia Nguyễn' }) } });
  assert.equal(byId(plan).B.set.customer_id, 'c1');
  assert.equal(byId(plan).B.set.temporary_name, null);
});

// --- Trạng thái + hủy (#13): hủy = status cancelled, đổi trạng thái theo "Cả nhóm / Chỉ khách này" ---
const idsOf = (plan) => plan.targets.map(t => t.id).sort();

test('lịch lẻ đổi trạng thái → chỉ lịch này, không hỏi phạm vi', () => {
  const plan = planStatusChange({ booking: booking(), status: 'cancelled' });
  assert.deepEqual(idsOf(plan), ['bk1']);
  assert.deepEqual(plan.targets[0].set, { status: 'cancelled' });
});

test('lịch thuộc nhóm đổi trạng thái mà không gửi scope → hỏi (scopeRequired + số khách chưa hủy), không có kế hoạch ghi', () => {
  const cancelled = booking({ id: 'C', group_booking_id: 'g1', status: 'cancelled' });
  const plan = planStatusChange({ booking: groupA(), group: [groupB(), cancelled], status: 'cancelled' });
  assert.equal(plan.scopeRequired, true);
  assert.equal(plan.groupSize, 2);
  assert.equal(plan.targets, undefined);
});

test('Cả nhóm đổi trạng thái → mọi khách chưa hủy, khách đã hủy bỏ qua; Chỉ khách này → chỉ lịch này', () => {
  const cancelled = booking({ id: 'C', group_booking_id: 'g1', status: 'cancelled' });
  const group = planStatusChange({ booking: groupA(), group: [groupB(), cancelled], status: 'completed', scope: 'group' });
  assert.deepEqual(idsOf(group), ['A', 'B']);
  assert.ok(group.targets.every(t => t.set.status === 'completed'));

  const one = planStatusChange({ booking: groupA(), group: [groupB(), cancelled], status: 'completed', scope: 'booking' });
  assert.deepEqual(idsOf(one), ['A']);
});

test('hủy Cả nhóm bỏ qua khách đã đến / đã hoàn thành; nếu chỉ còn họ thì không hỏi phạm vi', () => {
  const arrived = booking({ id: 'C', group_booking_id: 'g1', status: 'arrived' });
  const done = booking({ id: 'D', group_booking_id: 'g1', status: 'completed' });
  const plan = planStatusChange({ booking: groupA(), group: [groupB(), arrived, done], status: 'cancelled', scope: 'group' });
  assert.deepEqual(idsOf(plan), ['A', 'B']);

  const ask = planStatusChange({ booking: groupA(), group: [groupB(), arrived, done], status: 'cancelled' });
  assert.equal(ask.groupSize, 2);

  const alone = planStatusChange({ booking: groupA(), group: [arrived, done, booking({ id: 'E', group_booking_id: 'g1', status: 'cancelled' })], status: 'cancelled' });
  assert.deepEqual(idsOf(alone), ['A'], 'không còn ai để hủy cùng → như lịch lẻ');
});

test('rời trạng thái đã hủy (khôi phục / bấm nhầm hủy) → phải xếp lại vị trí; hỏi phạm vi nếu khách khác cũng đã hủy, Cả nhóm = mọi khách đã hủy', () => {
  const cancelledA = groupA({ status: 'cancelled' });
  const cancelledB = groupB({ status: 'cancelled' });
  const stillOn = booking({ id: 'C', group_booking_id: 'g1', status: 'confirmed' });

  const ask = planStatusChange({ booking: cancelledA, group: [cancelledB, stillOn], status: 'confirmed' });
  assert.equal(ask.scopeRequired, true);
  assert.equal(ask.groupSize, 2);

  const all = planStatusChange({ booking: cancelledA, group: [cancelledB, stillOn], status: 'completed', scope: 'group' });
  assert.deepEqual(idsOf(all), ['A', 'B']);
  assert.ok(all.targets.every(t => t.placementChanged === true && t.set.status === 'completed'));

  const one = planStatusChange({ booking: cancelledA, group: [cancelledB], status: 'pending', scope: 'booking' });
  assert.deepEqual(idsOf(one), ['A']);
  assert.equal(one.targets[0].placementChanged, true);

  // Không rời trạng thái hủy → không đổi vị trí
  const cancel = planStatusChange({ booking: booking(), status: 'cancelled' });
  assert.equal(cancel.targets[0].placementChanged, false);
});

test('đổi sang đúng trạng thái đang có → từ chối, không có kế hoạch ghi', () => {
  const plan = planStatusChange({ booking: booking({ status: 'cancelled' }), status: 'cancelled' });
  assert.ok(plan.refused);
  assert.equal(plan.targets, undefined);
});

test('Cả nhóm bỏ qua khách đã ở đúng trạng thái đích (không ghi lại, không xoay tour lần nữa)', () => {
  const done = booking({ id: 'C', group_booking_id: 'g1', status: 'completed' });
  const plan = planStatusChange({ booking: groupA(), group: [groupB(), done], status: 'completed', scope: 'group' });
  assert.deepEqual(idsOf(plan), ['A', 'B']);

  const ask = planStatusChange({ booking: groupA(), group: [done], status: 'completed' });
  assert.equal(ask.scopeRequired, undefined, 'khách còn lại đã hoàn thành → không cần hỏi');
});

test('hủy Cả nhóm bắt đầu từ khách đã đến / đã xong → bỏ qua cả khách đó (báo trong skippedIds); không còn ai để hủy → từ chối', () => {
  const plan = planStatusChange({ booking: groupA({ status: 'arrived' }), group: [groupB()], status: 'cancelled', scope: 'group' });
  assert.deepEqual(idsOf(plan), ['B']);
  assert.deepEqual(plan.skippedIds, ['A']);

  const nothing = planStatusChange({ booking: booking({ status: 'completed' }), status: 'cancelled', scope: 'group' });
  assert.ok(nothing.refused, 'không còn ai để hủy');
  assert.equal(nothing.targets, undefined);

  // Chỉ khách này vẫn hủy được khách đã đến
  const one = planStatusChange({ booking: groupA({ status: 'arrived' }), group: [groupB()], status: 'cancelled', scope: 'booking' });
  assert.deepEqual(idsOf(one), ['A']);
});
