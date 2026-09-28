/**
 * Xếp nhân viên + giường cho CẢ NHÓM khách trước khi ghi DB.
 * Trước đây mỗi khách được insert ngay trong vòng lặp → đến khách thứ 2 hết người thì
 * trả lỗi nhưng lịch của khách 1 đã nằm trong DB (nhóm dở dang, khách đặt lại sinh lịch trùng).
 * Giờ lên kế hoạch cho đủ cả nhóm trong bộ nhớ; thiếu 1 người là trả lỗi, chưa ghi gì.
 *
 * Quy tắc giữ nguyên như code cũ:
 *  - Nhân viên bận nếu có lịch chồng giờ, tính thêm bufferTime sau giờ kết thúc lịch cũ.
 *  - Giường bận nếu có lịch chồng giờ (không tính buffer).
 *  - Nhân viên xếp theo thứ tự tour; khách đầu tiên ưu tiên nhân viên được chỉ định (nếu rảnh).
 *  - Giường ưu tiên cái ít lịch nhất trong ngày.
 */
const { sortByTourOrder } = require('./tourOrder');

function toMinutes(timeStr) {
  const [h, m] = String(timeStr || '0:0').split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/**
 * @returns {{ ok: true, assignments: { employee_id: string, bed_id: string }[] }
 *         | { ok: false, reason: 'no_employee' | 'no_bed' }}
 */
function planGroupAssignment({
  guestCount,
  startMinutes,
  endMinutes,
  dayBookings = [],
  employees = [],
  beds = [],
  bufferTime = 0,
  tourOrder = [],
  requestedEmployeeId = null
}) {
  const overlaps = (b, buffer) =>
    startMinutes < toMinutes(b.end_time) + buffer && toMinutes(b.start_time) < endMinutes;

  const busyEmployeeIds = new Set(
    dayBookings.filter(b => b.employee_id && overlaps(b, bufferTime)).map(b => b.employee_id)
  );
  const busyBedIds = new Set(
    dayBookings.filter(b => b.bed_id && overlaps(b, 0)).map(b => b.bed_id)
  );

  const bedBookingCount = {};
  for (const bed of beds) bedBookingCount[bed.id] = 0;
  for (const b of dayBookings) {
    if (bedBookingCount[b.bed_id] !== undefined) bedBookingCount[b.bed_id]++;
  }

  const assignments = [];
  for (let g = 0; g < guestCount; g++) {
    const availableEmployees = sortByTourOrder(employees.filter(e => !busyEmployeeIds.has(e.id)), tourOrder);
    if (availableEmployees.length === 0) return { ok: false, reason: 'no_employee' };

    let employee = availableEmployees[0];
    if (g === 0 && requestedEmployeeId) {
      employee = availableEmployees.find(e => e.id === requestedEmployeeId) || employee;
    }

    const availableBeds = beds
      .filter(b => !busyBedIds.has(b.id))
      .sort((a, b) => (bedBookingCount[a.id] || 0) - (bedBookingCount[b.id] || 0));
    if (availableBeds.length === 0) return { ok: false, reason: 'no_bed' };
    const bed = availableBeds[0];

    // Khách sau không được xếp trùng người / giường với khách trước trong cùng nhóm
    busyEmployeeIds.add(employee.id);
    busyBedIds.add(bed.id);
    bedBookingCount[bed.id] = (bedBookingCount[bed.id] || 0) + 1;

    assignments.push({ employee_id: employee.id, bed_id: bed.id });
  }

  return { ok: true, assignments };
}

module.exports = { planGroupAssignment };
