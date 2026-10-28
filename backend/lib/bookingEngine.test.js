const test = require('node:test');
const assert = require('node:assert/strict');
const { policyFor, planPlacements, describeConflict } = require('./bookingEngine');

const NOW = Date.parse('2026-11-09T08:00:00Z');
const shift = (start = '09:00', end = '22:00') => ({ start_time: start, end_time: end, is_day_off: false });

function makeDay({ bookings = [], employees = ['e1', 'e2', 'e3'], beds = ['b1', 'b2', 'b3'], schedules, tourOrder = [] } = {}) {
  return {
    now: NOW,
    bookings,
    employees: employees.map(id => ({ id, name: id.toUpperCase() })),
    employeeNames: Object.fromEntries(employees.map(id => [id, id.toUpperCase()])),
    schedules: new Map(Object.entries(schedules || Object.fromEntries(employees.map(id => [id, shift()])))),
    beds: beds.map(id => ({ id, name: id.toUpperCase() })),
    tourOrder
  };
}
const booking = (o) => ({ id: o.id || `x-${Math.random()}`, status: 'confirmed', start_time: '15:00', end_time: '16:00', employee_id: null, bed_id: null, temporary_name: 'Khách', ...o });
const item = (o = {}) => ({ ref: 0, start: '15:00', end: '16:00', autoEmployee: true, ...o });
const staff = policyFor('staff', {});
const types = (plan) => plan.conflicts.map(c => c.type).sort();

// ---- Chính sách theo nguồn ----
test('buffer: chỉ khách online; chưa cài = 0; "0" = 0', () => {
  assert.equal(policyFor('web', { buffer_time: 20 }).employeeBuffer, 20);
  assert.equal(policyFor('web', {}).employeeBuffer, 0);
  assert.equal(policyFor('web', { buffer_time: '0' }).employeeBuffer, 0);
  assert.equal(policyFor('ai', { buffer_time: 20 }).employeeBuffer, 0);
  assert.equal(policyFor('staff', { buffer_time: 20 }).employeeBuffer, 0);
});

test('online không bao giờ được ghi đè; staff/AI hỏi trước trừ khi tắt setting', () => {
  assert.equal(policyFor('web', { confirm_staff_overlap: false }).canOverride, false);
  assert.equal(policyFor('staff', {}).askFirst, true);
  assert.equal(policyFor('staff', { confirm_staff_overlap: false }).askFirst, false);
  assert.equal(policyFor('ai', { confirm_staff_overlap: 'false' }).askFirst, false);
  assert.throws(() => policyFor('robot', {}));
});

// ---- Nhân viên ----
test('tự xếp: người rảnh đầu tiên theo thứ tự tour', () => {
  const plan = planPlacements({ day: makeDay({ tourOrder: ['e3', 'e1'] }), policy: staff, items: [item()] });
  assert.equal(plan.assignments[0].employee_id, 'e3');
  assert.deepEqual(plan.conflicts, []);
});

test('tự xếp: bỏ qua người bận và người ngoài ca', () => {
  const day = makeDay({
    bookings: [booking({ employee_id: 'e1' })],
    schedules: { e1: shift(), e2: shift('09:00', '12:00'), e3: shift() }
  });
  const plan = planPlacements({ day, policy: staff, items: [item()] });
  assert.equal(plan.assignments[0].employee_id, 'e3');
});

test('không ai rảnh → no_employee, employee_id null', () => {
  const day = makeDay({ employees: ['e1'], bookings: [booking({ employee_id: 'e1' })] });
  const plan = planPlacements({ day, policy: staff, items: [item()] });
  assert.deepEqual(types(plan), ['no_employee']);
  assert.equal(plan.assignments[0].employee_id, null);
});

test('chỉ định NV đang bận → employee_busy kèm lịch bị trùng, vẫn giữ đúng NV', () => {
  const day = makeDay({ bookings: [booking({ id: 'b-x', employee_id: 'e1', temporary_name: 'Chị Hoa' })] });
  const plan = planPlacements({ day, policy: staff, items: [item({ employeeId: 'e1' })] });
  assert.deepEqual(types(plan), ['employee_busy']);
  assert.equal(plan.assignments[0].employee_id, 'e1');
  assert.deepEqual(
    { id: plan.conflicts[0].id, name: plan.conflicts[0].customer_name, s: plan.conflicts[0].start_time, e: plan.conflicts[0].end_time },
    { id: 'b-x', name: 'Chị Hoa', s: '15:00', e: '16:00' });
});

test('chỉ định NV ngoài ca / không có ca → off_shift', () => {
  const day = makeDay({ schedules: { e1: shift('09:00', '12:00'), e2: { ...shift(), is_day_off: true } } });
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ employeeId: 'e1' })] })), ['off_shift']);
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ employeeId: 'e2' })] })), ['off_shift']);
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ employeeId: 'e3' })] })), ['off_shift']);
});

test('buffer áp dụng sau lịch trước (online), không áp cho staff', () => {
  const day = makeDay({ employees: ['e1'], bookings: [booking({ employee_id: 'e1', start_time: '14:00', end_time: '15:00' })] });
  const web = policyFor('web', { buffer_time: 15 });
  assert.deepEqual(types(planPlacements({ day, policy: web, items: [item()] })), ['no_employee']);
  assert.deepEqual(types(planPlacements({ day, policy: web, items: [item({ start: '15:15', end: '16:15' })] })), []);
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item()] })), []);
});

test('fallbackAuto: NV yêu cầu bận → tự lấy người khác (trừ người bị loại)', () => {
  const day = makeDay({ bookings: [booking({ employee_id: 'e2' })] });
  const plan = planPlacements({ day, policy: staff, items: [item({ employeeId: 'e2', fallbackAuto: true, excludeEmployeeIds: ['e1'] })] });
  assert.equal(plan.assignments[0].employee_id, 'e3');
  assert.deepEqual(plan.conflicts, []);
});

test('không chỉ định và không tự xếp → giữ chưa xếp NV, không cảnh báo', () => {
  const plan = planPlacements({ day: makeDay(), policy: staff, items: [item({ autoEmployee: false })] });
  assert.equal(plan.assignments[0].employee_id, null);
  assert.deepEqual(plan.conflicts, []);
});

// ---- Giường ----
test('giữ giường cũ nếu còn trống', () => {
  const plan = planPlacements({ day: makeDay(), policy: staff, items: [item({ bedId: 'b2' })] });
  assert.equal(plan.assignments[0].bed_id, 'b2');
});

test('giường cũ bận → tự lấy giường trống khác, không cảnh báo', () => {
  const day = makeDay({ bookings: [booking({ bed_id: 'b2' })] });
  const plan = planPlacements({ day, policy: staff, items: [item({ bedId: 'b2' })] });
  assert.ok(['b1', 'b3'].includes(plan.assignments[0].bed_id));
  assert.deepEqual(plan.conflicts, []);
});

test('giường cũ thuộc chi nhánh khác (đổi chi nhánh) → lấy giường của chi nhánh mới', () => {
  const plan = planPlacements({ day: makeDay(), policy: staff, items: [item({ bedId: 'old-branch-bed' })] });
  assert.ok(['b1', 'b2', 'b3'].includes(plan.assignments[0].bed_id));
});

test('ưu tiên giường ít lịch nhất trong ngày', () => {
  const day = makeDay({ bookings: [booking({ bed_id: 'b1', start_time: '09:00', end_time: '10:00' }), booking({ bed_id: 'b2', start_time: '10:00', end_time: '11:00' })] });
  assert.equal(planPlacements({ day, policy: staff, items: [item()] }).assignments[0].bed_id, 'b3');
});

test('hết giường / chi nhánh không có giường → no_bed, bed_id null', () => {
  const full = makeDay({ beds: ['b1'], bookings: [booking({ bed_id: 'b1' })] });
  assert.deepEqual(types(planPlacements({ day: full, policy: staff, items: [item()] })), ['no_bed']);
  const none = makeDay({ beds: [] });
  const plan = planPlacements({ day: none, policy: staff, items: [item()] });
  assert.deepEqual(types(plan), ['no_bed']);
  assert.equal(plan.assignments[0].bed_id, null);
});

// ---- Nhóm & dữ liệu bỏ qua ----
test('nhóm: mỗi khách 1 NV và 1 giường khác nhau', () => {
  const plan = planPlacements({ day: makeDay(), policy: staff, items: [item({ ref: 0 }), item({ ref: 1 }), item({ ref: 2 })] });
  assert.equal(new Set(plan.assignments.map(a => a.employee_id)).size, 3);
  assert.equal(new Set(plan.assignments.map(a => a.bed_id)).size, 3);
});

test('nhóm đông hơn số NV rảnh → no_employee cho khách thiếu', () => {
  const plan = planPlacements({ day: makeDay({ employees: ['e1', 'e2'] }), policy: staff, items: [item({ ref: 0 }), item({ ref: 1 }), item({ ref: 2 })] });
  assert.deepEqual(plan.conflicts.map(c => [c.type, c.ref]), [['no_employee', 2]]);
});

test('nhóm chỉ định cùng 1 NV cho 2 khách → khách thứ 2 bị employee_busy', () => {
  const plan = planPlacements({ day: makeDay(), policy: staff, items: [item({ ref: 0, employeeId: 'e1' }), item({ ref: 1, employeeId: 'e1' })] });
  assert.deepEqual(plan.conflicts.map(c => [c.type, c.ref]), [['employee_busy', 1]]);
});

test('bỏ qua: lịch đang được dời, lịch đã hủy, giữ chỗ hết hạn; giữ chỗ còn hạn vẫn chặn', () => {
  const HOLD = '[GIỮ CHỖ TẠM THỜI] x';
  const day = makeDay({
    employees: ['e1'],
    bookings: [
      booking({ id: 'moving', employee_id: 'e1' }),
      booking({ employee_id: 'e1', status: 'cancelled' }),
      booking({ employee_id: 'e1', status: 'pending', internal_note: `${HOLD} EXPIRES:${NOW - 1000}` })
    ]
  });
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ employeeId: 'e1' })], excludeIds: ['moving'] })), []);

  day.bookings.push(booking({ employee_id: 'e1', status: 'pending', internal_note: `${HOLD} EXPIRES:${NOW + 60000}` }));
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ employeeId: 'e1' })], excludeIds: ['moving'] })), ['employee_busy']);
});

test('NV bận ở chi nhánh khác cùng ngày vẫn tính là bận', () => {
  const day = makeDay({ bookings: [booking({ employee_id: 'e1', branch_id: 'other' })] });
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ employeeId: 'e1' })] })), ['employee_busy']);
});

// ---- Thông báo ----
test('mỗi loại vướng mắc có câu tiếng Việt dễ hiểu', () => {
  assert.match(describeConflict({ type: 'employee_busy', employee_name: 'Duyên', customer_name: 'Chị Hoa', start_time: '15:00', end_time: '16:00' }), /Duyên.*Chị Hoa.*15:00.*16:00/);
  assert.match(describeConflict({ type: 'off_shift', employee_name: 'Duyên', shift_start: '09:00', shift_end: '12:00' }), /Duyên.*ngoài ca.*09:00.*12:00/);
  assert.match(describeConflict({ type: 'off_shift', employee_name: 'Duyên' }), /Duyên.*không có ca/);
  assert.match(describeConflict({ type: 'no_employee' }), /nhân viên/);
  assert.match(describeConflict({ type: 'no_bed' }), /giường/);
});

// ---- Giờ nhận khách muộn nhất (Last booking time) — ROADMAP.md › "Time limits" ----
const closingAt = (lastBookingTime, o) => ({ ...makeDay(o), lastBookingTime });

test('bắt đầu đúng Last booking time → không vướng; muộn 1 phút → after_last_booking', () => {
  const day = closingAt('20:00');
  assert.deepEqual(planPlacements({ day, policy: staff, items: [item({ start: '20:00', end: '21:30' })] }).conflicts, []);
  const late = planPlacements({ day, policy: staff, items: [item({ start: '20:01', end: '21:31' })] });
  assert.deepEqual(types(late), ['after_last_booking']);
  assert.equal(late.conflicts[0].last_booking_time, '20:00');
});

test('Last booking time có phút (19:30): 19:30 được, 19:31 vướng', () => {
  const day = closingAt('19:30');
  assert.deepEqual(planPlacements({ day, policy: staff, items: [item({ start: '19:30', end: '21:00' })] }).conflicts, []);
  assert.deepEqual(types(planPlacements({ day, policy: staff, items: [item({ start: '19:31', end: '21:01' })] })), ['after_last_booking']);
});

test('lịch kết thúc sau Last booking time nhưng bắt đầu trước → không vướng (Closing time = sau khách cuối)', () => {
  const plan = planPlacements({ day: closingAt('20:00'), policy: staff, items: [item({ start: '19:00', end: '21:30' })] });
  assert.deepEqual(plan.conflicts, []);
});

test('check-in (skipStartLimit) chưa áp Last booking time — chờ Late arrival grace (#14)', () => {
  const plan = planPlacements({ day: closingAt('20:00'), policy: staff, items: [item({ start: '20:30', end: '21:30', skipStartLimit: true })] });
  assert.deepEqual(plan.conflicts, []);
});

test('lý do "Vẫn lưu?" cho after_last_booking nêu giờ nhận khách muộn nhất', () => {
  assert.equal(describeConflict({ type: 'after_last_booking', last_booking_time: '20:00' }), 'Quá giờ nhận khách (nhận khách muộn nhất 20:00)');
});

test('lịch vượt qua nửa đêm → refusal CROSSES_MIDNIGHT (không phải vướng mắc để "Vẫn lưu"); kết thúc đúng 24:00 thì được', () => {
  const day = makeDay({ schedules: { e1: shift('09:00', '24:00'), e2: shift('09:00', '24:00'), e3: shift('09:00', '24:00') } });
  const over = planPlacements({ day, policy: staff, items: [item({ start: '23:00', end: '24:30' })] });
  assert.equal(over.refusal.code, 'CROSSES_MIDNIGHT');
  assert.match(over.refusal.message, /nửa đêm/);
  const wrapped = planPlacements({ day, policy: staff, items: [item({ start: '23:00', end: '00:30' })] });
  assert.equal(wrapped.refusal.code, 'CROSSES_MIDNIGHT');
  const exact = planPlacements({ day, policy: staff, items: [item({ start: '23:00', end: '24:00' })] });
  assert.equal(exact.refusal, undefined);
});

// ---- Late arrival grace (#14): check-in muộn hơn Last booking time + grace → "Vẫn lưu?" ----
test('late_arrival_grace: chưa cài = 15; "0" = 0; "20" = 20; giá trị sai = 15', () => {
  assert.equal(policyFor('staff', {}).lateArrivalGrace, 15);
  assert.equal(policyFor('staff', { late_arrival_grace: '0' }).lateArrivalGrace, 0);
  assert.equal(policyFor('ai', { late_arrival_grace: '20' }).lateArrivalGrace, 20);
  assert.equal(policyFor('staff', { late_arrival_grace: 'abc' }).lateArrivalGrace, 15);
  assert.equal(policyFor('staff', { late_arrival_grace: -5 }).lateArrivalGrace, 15);
});

test('check-in đúng Last booking time + grace → không vướng; muộn 1 phút → late_check_in', () => {
  const day = closingAt('20:00');
  const atGrace = planPlacements({ day, policy: staff, items: [item({ start: '20:15', end: '21:15', checkIn: true })] });
  assert.deepEqual(atGrace.conflicts, []);
  const late = planPlacements({ day, policy: staff, items: [item({ start: '20:16', end: '21:16', checkIn: true })] });
  assert.deepEqual(types(late), ['late_check_in']);
  assert.equal(late.conflicts[0].last_booking_time, '20:00');
  assert.equal(late.conflicts[0].grace, 15);
});

test('check-in trong grace (20:10, nhận khách muộn nhất 20:00) → không có lý do after_last_booking', () => {
  const plan = planPlacements({ day: closingAt('20:00'), policy: staff, items: [item({ start: '20:10', end: '21:10', checkIn: true })] });
  assert.deepEqual(plan.conflicts, []);
});

test('grace theo setting: 0 → check-in 20:01 đã vướng; ngày nghỉ (không có Last booking time) → không vướng', () => {
  const noGrace = policyFor('staff', { late_arrival_grace: 0 });
  assert.deepEqual(types(planPlacements({ day: closingAt('20:00'), policy: noGrace, items: [item({ start: '20:01', end: '21:01', checkIn: true })] })), ['late_check_in']);
  assert.deepEqual(planPlacements({ day: closingAt(null), policy: staff, items: [item({ start: '21:00', end: '22:00', checkIn: true })] }).conflicts, []);
});

test('lý do "Vẫn lưu?" cho late_check_in nêu giờ nhận khách muộn nhất và số phút trễ tối đa', () => {
  assert.equal(describeConflict({ type: 'late_check_in', last_booking_time: '20:00', grace: 15 }), 'Check-in quá giờ (nhận khách muộn nhất 20:00, trễ tối đa 15 phút)');
});
