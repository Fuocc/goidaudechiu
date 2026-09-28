const test = require('node:test');
const assert = require('node:assert/strict');
const { planGroupAssignment } = require('./groupPlanner');

const employees = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
const beds = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
// Khung 10:00-11:00
const slot = { startMinutes: 600, endMinutes: 660 };

test('xếp đủ cả nhóm, mỗi khách một nhân viên và một giường khác nhau', () => {
  const plan = planGroupAssignment({ ...slot, guestCount: 3, employees, beds });
  assert.equal(plan.ok, true);
  assert.equal(new Set(plan.assignments.map(a => a.employee_id)).size, 3);
  assert.equal(new Set(plan.assignments.map(a => a.bed_id)).size, 3);
});

test('thiếu nhân viên ở khách cuối → báo lỗi, không trả về kế hoạch dở dang', () => {
  const dayBookings = [{ employee_id: 'e1', bed_id: null, start_time: '10:00', end_time: '11:00' }];
  const plan = planGroupAssignment({ ...slot, guestCount: 3, employees, beds, dayBookings });
  assert.deepEqual(plan, { ok: false, reason: 'no_employee' });
});

test('thiếu giường → báo lỗi no_bed', () => {
  const plan = planGroupAssignment({ ...slot, guestCount: 2, employees, beds: [{ id: 'b1' }] });
  assert.deepEqual(plan, { ok: false, reason: 'no_bed' });
});

test('buffer sau lịch cũ làm nhân viên bận, giường thì không tính buffer', () => {
  // Lịch cũ 09:00-09:50 + buffer 15 → nhân viên e1 bận tới 10:05
  const dayBookings = [{ employee_id: 'e1', bed_id: 'b1', start_time: '09:00', end_time: '09:50' }];
  const plan = planGroupAssignment({ ...slot, guestCount: 1, employees, beds, dayBookings, bufferTime: 15 });
  assert.equal(plan.ok, true);
  assert.notEqual(plan.assignments[0].employee_id, 'e1');

  const noBuffer = planGroupAssignment({ ...slot, guestCount: 1, employees, beds, dayBookings, bufferTime: 0 });
  assert.equal(noBuffer.assignments[0].employee_id, 'e1');
});

test('theo thứ tự tour, khách đầu ưu tiên nhân viên được chỉ định', () => {
  const tourOrder = ['e3', 'e2', 'e1'];
  const byTour = planGroupAssignment({ ...slot, guestCount: 2, employees, beds, tourOrder });
  assert.deepEqual(byTour.assignments.map(a => a.employee_id), ['e3', 'e2']);

  const requested = planGroupAssignment({ ...slot, guestCount: 2, employees, beds, tourOrder, requestedEmployeeId: 'e1' });
  assert.deepEqual(requested.assignments.map(a => a.employee_id), ['e1', 'e3']);
});

test('giường ưu tiên cái ít lịch nhất trong ngày', () => {
  const dayBookings = [
    { employee_id: 'x', bed_id: 'b1', start_time: '08:00', end_time: '09:00' },
    { employee_id: 'x', bed_id: 'b1', start_time: '12:00', end_time: '13:00' },
    { employee_id: 'x', bed_id: 'b2', start_time: '12:00', end_time: '13:00' }
  ];
  const plan = planGroupAssignment({ ...slot, guestCount: 2, employees, beds, dayBookings });
  assert.deepEqual(plan.assignments.map(a => a.bed_id), ['b3', 'b2']);
});
