/**
 * Booking engine dùng chung cho MỌI đường ghi lịch: khách online, giữ chỗ, nhân viên (tạo / sửa / kéo thả /
 * check-in) và trợ lý AI. Quy tắc theo nguồn — xem ROADMAP.md › "Booking rules":
 *
 *   | Nguồn  | Buffer        | Ca / giường        | Chồng lịch                                         |
 *   | web    | setting       | bắt buộc           | không bao giờ                                      |
 *   | ai     | không         | bắt buộc           | chỉ khi có token xác nhận (hoặc tắt setting)       |
 *   | staff  | không         | cảnh báo           | sau khi bấm "Vẫn lưu" (hoặc tắt setting)           |
 *
 * Luồng: planPlacements() chọn NV + giường trong bộ nhớ và liệt kê vướng mắc → placeBookings() ghi qua
 * hàm SQL booking_guard_write (khóa theo ngày → kiểm tra lại → ghi trong 1 transaction). Request thua
 * trong tranh chấp được lên kế hoạch lại 1 lần với dữ liệu mới.
 */
const { sortByTourOrder, loadTourOrder } = require('./tourOrder');
const { isExpiredHold } = require('./holds');
const { branchDayHours } = require('./branchHours');

const toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
};
const hhmm = (t) => String(t || '').slice(0, 5);

// ---------------------------------------------------------------------------
// Chính sách theo nguồn

function readBuffer(settings) {
  const n = parseInt(settings?.buffer_time, 10);
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 = không buffer, chưa cài = 0
}

function askBeforeOverlap(settings) {
  const v = settings?.confirm_staff_overlap;
  return !(v === false || v === 'false'); // chưa cài = bật
}

// Late arrival grace (phút, chỉ cho check-in): chưa cài / sai = 15
function readLateArrivalGrace(settings) {
  const n = parseInt(settings?.late_arrival_grace, 10);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

function policyFor(source, settings = {}) {
  const lateArrivalGrace = readLateArrivalGrace(settings);
  switch (source) {
    case 'web': return { source, employeeBuffer: readBuffer(settings), canOverride: false, askFirst: true, lateArrivalGrace };
    case 'ai':
    case 'staff': return { source, employeeBuffer: 0, canOverride: true, askFirst: askBeforeOverlap(settings), lateArrivalGrace };
    default: throw new Error(`Nguồn đặt lịch không hợp lệ: ${source}`);
  }
}

// ---------------------------------------------------------------------------
// Lên kế hoạch (thuần, không đụng DB)

/**
 * @param day   { now, bookings, employees:[{id,name}], employeeNames:{id:name}, schedules: Map id→ca, beds:[{id,name}], tourOrder }
 *              bookings = mọi lịch trong NGÀY (mọi chi nhánh — NV bận ở chi nhánh khác vẫn là bận)
 *              lastBookingTime: "HH:MM" giờ nhận khách muộn nhất của chi nhánh ngày đó (null = không giới hạn)
 * @param items [{ ref, start, end, employeeId?, autoEmployee?, fallbackAuto?, excludeEmployeeIds?, bedId?, name?, skipStartLimit?, checkIn? }]
 *   - skipStartLimit: không áp Last booking time (đặt lại lịch ở đúng giờ bắt đầu cũ)
 *   - checkIn: giờ check-in → giới hạn là Last booking time + Late arrival grace (policy.lateArrivalGrace)
 *   - employeeId: NV được chỉ định → giữ đúng người, bận / ngoài ca thì báo vướng mắc
 *     (fallbackAuto: bận / ngoài ca thì tự lấy người khác thay vì báo)
 *   - không chỉ định + autoEmployee → người rảnh đầu tiên theo tour; không ai rảnh → no_employee
 *   - bedId: giường đang dùng → giữ nếu còn trống, không thì tự lấy giường trống khác; hết giường → no_bed
 * @param excludeIds lịch đang được dời / chốt (không tính trùng với chính nó)
 * @returns {{ assignments: {ref, employee_id, bed_id}[], conflicts: object[], refusal?: { code, message } }}
 *   refusal: không lưu được dù đã xác nhận (VD vượt qua nửa đêm)
 */
function planPlacements({ day, policy, items, excludeIds = [] }) {
  const now = day.now ?? Date.now();
  const exclude = new Set(excludeIds);
  const live = (day.bookings || []).filter(b => !exclude.has(b.id) && b.status !== 'cancelled' && !isExpiredHold(b, now));
  const planned = []; // vị trí đã xếp cho các khách trước trong cùng lệnh
  const all = () => live.concat(planned);

  const nameOf = (id) => day.employeeNames?.[id] || day.employees.find(e => e.id === id)?.name || 'Nhân viên';
  const scheduleOf = (id) => (day.schedules instanceof Map ? day.schedules.get(id) : day.schedules?.[id]);
  const onShift = (id, s, e) => {
    const sc = scheduleOf(id);
    if (!sc || sc.is_day_off || !sc.start_time || !sc.end_time) return false;
    return s >= toMin(sc.start_time) && e <= toMin(sc.end_time);
  };
  const employeeClashes = (id, s, e) => all().filter(b =>
    b.employee_id === id && s < toMin(b.end_time) + policy.employeeBuffer && toMin(b.start_time) < e);
  const bedBusy = (id, s, e) => all().some(b => b.bed_id === id && s < toMin(b.end_time) && toMin(b.start_time) < e);

  const bedUse = {};
  for (const b of live) if (b.bed_id) bedUse[b.bed_id] = (bedUse[b.bed_id] || 0) + 1;

  // Lịch không bao giờ vượt qua nửa đêm — từ chối hẳn, không "Vẫn lưu" được (mọi nguồn)
  if (items.some(it => toMin(it.end) > 24 * 60 || toMin(it.end) < toMin(it.start))) {
    return { assignments: [], conflicts: [], refusal: { code: 'CROSSES_MIDNIGHT', message: 'Lịch không được kéo dài qua nửa đêm (24:00). Hãy chọn giờ sớm hơn.' } };
  }

  const assignments = [];
  const conflicts = [];

  for (const it of items) {
    const s = toMin(it.start);
    const e = toMin(it.end);
    const ref = it.ref;
    const excluded = new Set(it.excludeEmployeeIds || []);
    const pickFree = () => sortByTourOrder(
      day.employees.filter(emp => !excluded.has(emp.id) && onShift(emp.id, s, e) && employeeClashes(emp.id, s, e).length === 0),
      day.tourOrder || []
    )[0]?.id || null;

    // --- Nhân viên ---
    let employeeId = it.employeeId || null;
    if (employeeId) {
      const clashes = employeeClashes(employeeId, s, e);
      const offShift = !onShift(employeeId, s, e);
      if ((clashes.length || offShift) && it.fallbackAuto) {
        employeeId = pickFree();
        if (!employeeId) conflicts.push({ type: 'no_employee', ref });
      } else {
        for (const c of clashes) {
          conflicts.push({
            type: 'employee_busy', ref, employee_id: employeeId, employee_name: nameOf(employeeId),
            id: c.id, customer_name: c.temporary_name || c.customers?.name || 'Khách',
            start_time: hhmm(c.start_time), end_time: hhmm(c.end_time)
          });
        }
        if (offShift) {
          const sc = scheduleOf(employeeId);
          const hasShift = sc && !sc.is_day_off && sc.start_time && sc.end_time;
          conflicts.push({
            type: 'off_shift', ref, employee_id: employeeId, employee_name: nameOf(employeeId),
            shift_start: hasShift ? hhmm(sc.start_time) : null, shift_end: hasShift ? hhmm(sc.end_time) : null
          });
        }
      }
    } else if (it.autoEmployee) {
      employeeId = pickFree();
      if (!employeeId) conflicts.push({ type: 'no_employee', ref });
    }

    // --- Giờ nhận khách muộn nhất: bắt đầu sau Last booking time → online từ chối, staff / AI hỏi "Vẫn lưu?" ---
    if (day.lastBookingTime && it.checkIn) {
      // Check-in: khách đặt đúng giờ nhận khách muộn nhất vẫn được trễ tối đa grace phút mà không hỏi
      if (s > toMin(day.lastBookingTime) + policy.lateArrivalGrace) {
        conflicts.push({ type: 'late_check_in', ref, last_booking_time: hhmm(day.lastBookingTime), grace: policy.lateArrivalGrace });
      }
    } else if (day.lastBookingTime && !it.skipStartLimit && s > toMin(day.lastBookingTime)) {
      conflicts.push({ type: 'after_last_booking', ref, last_booking_time: hhmm(day.lastBookingTime) });
    }

    // --- Giường ---
    let bedId = null;
    if (it.bedId && day.beds.some(b => b.id === it.bedId) && !bedBusy(it.bedId, s, e)) {
      bedId = it.bedId;
    } else {
      bedId = day.beds
        .filter(b => !bedBusy(b.id, s, e))
        .sort((a, b) => (bedUse[a.id] || 0) - (bedUse[b.id] || 0))[0]?.id || null;
      if (!bedId) conflicts.push({ type: 'no_bed', ref });
    }

    planned.push({
      id: `plan:${ref}`, employee_id: employeeId, bed_id: bedId,
      start_time: it.start, end_time: it.end, temporary_name: it.name || 'khách cùng nhóm'
    });
    if (bedId) bedUse[bedId] = (bedUse[bedId] || 0) + 1;
    assignments.push({ ref, employee_id: employeeId, bed_id: bedId });
  }

  return { assignments, conflicts };
}

// ---------------------------------------------------------------------------
// Thông báo

function describeConflict(c) {
  switch (c.type) {
    case 'employee_busy':
      return `${c.employee_name || 'Nhân viên'} đang có lịch ${c.customer_name || 'khách khác'} ${c.start_time}–${c.end_time}`;
    case 'off_shift':
      return c.shift_start
        ? `${c.employee_name || 'Nhân viên'} ngoài ca (ca ${c.shift_start}–${c.shift_end})`
        : `${c.employee_name || 'Nhân viên'} không có ca làm hôm đó`;
    case 'no_employee': return 'Không còn nhân viên trống trong khung giờ này';
    case 'no_bed': return 'Không còn giường trống trong khung giờ này';
    case 'bed_busy': return `Giường đang được dùng bởi ${c.customer_name || 'khách khác'} ${c.start_time}–${c.end_time}`;
    case 'after_last_booking': return `Quá giờ nhận khách (nhận khách muộn nhất ${c.last_booking_time})`;
    case 'late_check_in': return `Check-in quá giờ (nhận khách muộn nhất ${c.last_booking_time}, trễ tối đa ${c.grace} phút)`;
    default: return 'Lịch bị trùng';
  }
}

const withMessages = (conflicts) => (conflicts || []).map(c => ({ ...c, message: describeConflict(c) }));
const summarizeConflicts = (conflicts) => [...new Set((conflicts || []).map(describeConflict))].join('; ');

// Khách online chỉ được biết loại vướng mắc — không lộ tên / giờ của khách khác
const publicConflicts = (conflicts) => [...new Set((conflicts || []).map(c => c.type))].map(type => ({ type }));

// ---------------------------------------------------------------------------
// Đọc dữ liệu

async function loadSettings(supabase) {
  const { data, error } = await supabase.from('settings').select('key, value').in('key', ['buffer_time', 'confirm_staff_overlap', 'late_arrival_grace']);
  if (error) throw error;
  return Object.fromEntries((data || []).map(r => [r.key, r.value]));
}

async function loadDay(supabase, { branchId, date }) {
  const [bookingsRes, employeesRes, schedulesRes, bedsRes, branchRes, tourOrder] = await Promise.all([
    supabase.from('bookings')
      .select('id, branch_id, employee_id, bed_id, start_time, end_time, status, internal_note, hold_expires_at, created_at, temporary_name, customers(name)')
      .eq('booking_date', date)
      .neq('status', 'cancelled'),
    supabase.from('employees').select('id, name, branch_id, is_active'),
    supabase.from('employee_schedules').select('employee_id, start_time, end_time, is_day_off').eq('date', date),
    supabase.from('beds').select('id, name').eq('branch_id', branchId).eq('is_active', true),
    supabase.from('branches').select('opening_hours').eq('id', branchId).maybeSingle(),
    loadTourOrder(supabase, branchId)
  ]);
  for (const r of [bookingsRes, employeesRes, schedulesRes, bedsRes, branchRes]) if (r.error) throw r.error;

  const allEmployees = employeesRes.data || [];
  return {
    now: Date.now(),
    bookings: bookingsRes.data || [],
    employees: allEmployees.filter(e => e.branch_id === branchId && e.is_active).map(({ id, name }) => ({ id, name })),
    employeeNames: Object.fromEntries(allEmployees.map(e => [e.id, e.name])),
    schedules: new Map((schedulesRes.data || []).map(s => [s.employee_id, s])),
    beds: bedsRes.data || [],
    // Ngày nghỉ → null (không thêm lý do; giữ như cũ)
    lastBookingTime: branchDayHours(branchRes.data?.opening_hours, date).lastBookingTime,
    tourOrder
  };
}

// ---------------------------------------------------------------------------
// Lên kế hoạch + ghi

/**
 * @param opts.source    'web' | 'ai' | 'staff'
 * @param opts.branchId  chi nhánh ĐÍCH (NV tự xếp + giường lấy theo chi nhánh này)
 * @param opts.date      ngày ĐÍCH của các items
 * @param opts.items     xem planPlacements
 * @param opts.excludeIds lịch đang được dời / chốt
 * @param opts.lockDates ngày khác cũng bị ghi (VD ngày cũ khi dời lịch sang ngày mới)
 * @param opts.override  true / (conflicts) => boolean — người dùng đã xác nhận "Vẫn lưu" cho ĐÚNG các vướng mắc này
 * @param opts.build     (assignments) => ({ inserts, updates }) — dòng cần ghi, đã gắn NV + giường
 * @returns { ok: true, ids, assignments, accepted } | { ok: false, conflicts, policy }
 *        | { ok: false, refused: { code, message }, conflicts: [] } — từ chối hẳn, xác nhận cũng không lưu
 */
async function placeBookings(supabase, { source, branchId, date, items, excludeIds = [], lockDates = [], override = false, settings, build }) {
  settings = settings || await loadSettings(supabase);
  const policy = policyFor(source, settings);

  for (let attempt = 1; ; attempt++) {
    const day = await loadDay(supabase, { branchId, date });
    const plan = planPlacements({ day, policy, items, excludeIds });
    if (plan.refusal) return { ok: false, refused: plan.refusal, conflicts: [], policy };

    let accepted = false;
    if (plan.conflicts.length) {
      const confirmed = typeof override === 'function' ? override(plan.conflicts) : override === true;
      accepted = policy.canOverride && (!policy.askFirst || confirmed);
      if (!accepted) return { ok: false, conflicts: plan.conflicts, policy };
    }

    const { inserts = [], updates = [] } = build(plan.assignments);
    const byRef = new Map(items.map(it => [it.ref, it]));
    // Đã chấp nhận chồng lịch → không kiểm tra lại (người dùng đã đồng ý); chưa → DB kiểm tra lại sau khi khóa
    const checks = accepted ? [] : plan.assignments.map(a => ({
      ref: a.ref, date, start_time: byRef.get(a.ref).start, end_time: byRef.get(a.ref).end,
      employee_id: a.employee_id, employee_buffer: policy.employeeBuffer, bed_id: a.bed_id
    }));

    const { data, error } = await supabase.rpc('booking_guard_write', {
      p: { lock_dates: [...new Set([date, ...lockDates])], exclude_ids: excludeIds, checks, inserts, updates }
    });
    if (error) throw error;
    if (data.ok) return { ok: true, ids: data.ids, assignments: plan.assignments, accepted: accepted ? plan.conflicts : [] };

    // Thua tranh chấp (request khác vừa ghi trước) → lên kế hoạch lại 1 lần với dữ liệu mới
    if (attempt >= 2) return { ok: false, conflicts: data.conflicts, policy };
  }
}

module.exports = {
  policyFor, planPlacements, describeConflict, withMessages, summarizeConflicts, publicConflicts,
  loadSettings, loadDay, placeBookings, toMin
};
