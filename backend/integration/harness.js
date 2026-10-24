/**
 * Harness cho test tích hợp "Booking guard" — chạy route THẬT + Supabase THẬT.
 *  - Chỉ thay phần xác thực Clerk (không phải đối tượng test): header `x-test-role: admin|staff` → req.auth,
 *    không có header = khách tự đặt online (public).
 *  - broadcastSSE = no-op → không gửi web push / SSE ra ngoài.
 *  - Dữ liệu mẫu (fixture) ghi THẲNG vào DB, không đi qua code đang test.
 *  - Mọi dữ liệu test mang tiền tố TEST_PREFIX và bị xóa trước/sau mỗi test.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const supabase = require('../supabaseClient');

const TEST_PREFIX = 'TEST-GUARD · ';
const BRANCH_NAME = 'CN 1 - Lê Văn Huân';

// Giờ Việt Nam (UTC+7)
function vnDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3);
  return d.toISOString().slice(0, 10);
}
function vnNowMinutes() {
  const d = new Date(Date.now() + 7 * 3600e3);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const TEST_DATE = vnDateStr(21); // trong cửa sổ 30 ngày lịch NV tự tạo và 120 ngày cho đặt online
const TODAY = vnDateStr(0);

let server;
let baseUrl;
let ipCounter = 0;
let phoneCounter = 0;
const ctx = {}; // branch, employees, beds, services — nạp ở setup()

async function setup() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    if (role) req.auth = { id: `test-${role}`, role, level: role === 'admin' ? 2 : 1 };
    next();
  });
  app.set('broadcastSSE', () => { });
  app.use('/api/bookings', require('../routes/bookings'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { data: branch } = await supabase.from('branches').select('*').eq('name', BRANCH_NAME).single();
  if (!branch) throw new Error(`Không tìm thấy chi nhánh "${BRANCH_NAME}"`);
  const { data: employees } = await supabase.from('employees').select('id, name').eq('branch_id', branch.id).eq('is_active', true);
  const { data: beds } = await supabase.from('beds').select('id, name').eq('branch_id', branch.id).eq('is_active', true);
  const { data: services } = await supabase.from('services').select('id, name, duration_minutes').eq('is_active', true);
  const { data: allBranches } = await supabase.from('branches').select('*');
  Object.assign(ctx, { branch, employees, beds, services, allBranches });

  // Ngày test phải trống (không có lịch thật) — nếu không, test có thể sai vì dữ liệu ngoài ý muốn
  const { data: foreign } = await supabase.from('bookings')
    .select('id, temporary_name, client_ip, customers(name)')
    .eq('branch_id', branch.id).eq('booking_date', TEST_DATE).neq('status', 'cancelled');
  const real = (foreign || []).filter(b => !isTestRow(b));
  if (real.length) throw new Error(`Ngày ${TEST_DATE} ở ${BRANCH_NAME} đã có ${real.length} lịch thật — đổi TEST_DATE.`);

  await cleanup();
}

async function teardown() {
  await cleanup();
  await new Promise((resolve) => server?.close(resolve));
}

// Giữ chỗ tạm thời dùng khách mặc định chung → nhận diện thêm theo dải IP test (198.51.100.x, TEST-NET-2)
const TEST_IP_PREFIX = '198.51.100.';
const isTestRow = (b) => (b.temporary_name || b.customers?.name || '').startsWith(TEST_PREFIX)
  || (b.client_ip || '').startsWith(TEST_IP_PREFIX);

async function cleanup() {
  for (const date of [TEST_DATE, TODAY]) {
    const { data } = await supabase.from('bookings').select('id, temporary_name, client_ip, customers(name)').eq('booking_date', date);
    const ids = (data || []).filter(isTestRow).map(b => b.id);
    if (ids.length) await supabase.from('bookings').delete().in('id', ids);
  }
  await supabase.from('customers').delete().like('name', `${TEST_PREFIX}%`);
}

function service(name) {
  const s = ctx.services.find(x => x.name === name);
  if (!s) throw new Error(`Thiếu dịch vụ "${name}"`);
  return s;
}
function employee(index) { return ctx.employees[index]; }

/** Ghi thẳng 1 lịch mẫu vào DB (không qua code đang test). */
async function insertFixture({ employeeId = null, bedId = null, branchId = ctx.branch.id, date = TEST_DATE, start, end, name = 'Fixture', status = 'confirmed', serviceName = 'Ý dễ chịu', groupId = null }) {
  const { data, error } = await supabase.from('bookings').insert({
    branch_id: branchId,
    employee_id: employeeId,
    bed_id: bedId,
    service_id: service(serviceName).id,
    booking_date: date,
    start_time: start,
    end_time: end,
    status,
    temporary_name: TEST_PREFIX + name,
    num_guests: 1,
    total_price: 0,
    group_booking_id: groupId // khách đi nhóm: các fixture cùng groupId
  }).select('*').single();
  if (error) throw error;
  return data;
}

/** Chiếm `count` nhân viên đầu (và giường tương ứng) trong khung giờ. Trả về các lịch đã tạo. */
async function occupyStaff(count, start, end, { date = TEST_DATE, withBeds = true } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(await insertFixture({
      employeeId: ctx.employees[i].id,
      bedId: withBeds ? ctx.beds[i].id : null,
      date, start, end, name: `Busy ${i + 1}`
    }));
  }
  return rows;
}

async function http(method, path, { body, role, ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (role) headers['x-test-role'] = role;
  headers['x-forwarded-for'] = ip || nextIp();
  const res = await fetch(baseUrl + '/api/bookings' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* không có body */ }
  return { status: res.status, data };
}

const nextIp = () => `${TEST_IP_PREFIX}${(++ipCounter % 250) + 1}`;
// 0999… : số test được rate limiter bỏ qua khi chạy local; vẫn là SĐT di động hợp lệ
const nextPhone = () => `0999${String(Date.now() % 1000).padStart(3, '0')}${String(++phoneCounter % 1000).padStart(3, '0')}`;

/** Khách tự đặt online (không đăng nhập). */
function onlineBook({ start, serviceName = 'Ý dễ chịu', guests = 1, date = TEST_DATE, name = 'Online' }) {
  return http('POST', '', {
    body: {
      branch_id: ctx.branch.id, service_id: service(serviceName).id, num_guests: guests,
      customer_name: TEST_PREFIX + name, customer_phone: nextPhone(), booking_date: date, start_time: start
    }
  });
}

/** Giữ chỗ tạm thời từ landing page (không đăng nhập). */
function onlineHold({ start, serviceName = 'Ý dễ chịu', guests = 1, date = TEST_DATE }) {
  return http('POST', '/hold', { body: { branch_id: ctx.branch.id, service_id: service(serviceName).id, num_guests: guests, booking_date: date, start_time: start } });
}

/** Nhân viên / admin tạo lịch trên dashboard. */
function staffBook({ start, end, employeeId, serviceName = 'Ý dễ chịu', date = TEST_DATE, name = 'Staff', allowConflict, role = 'admin' }) {
  const body = {
    branch_id: ctx.branch.id, service_id: service(serviceName).id, num_guests: 1,
    temporary_name: TEST_PREFIX + name, booking_date: date, start_time: start
  };
  if (end) body.end_time = end;
  if (employeeId) body.employee_id = employeeId;
  if (allowConflict !== undefined) body.allow_conflict = allowConflict;
  return http('POST', '', { role, body });
}

function staffUpdate(booking, changes, { allowConflict, role = 'admin' } = {}) {
  const body = {
    service_id: booking.service_id, branch_id: booking.branch_id, employee_id: booking.employee_id,
    booking_date: booking.booking_date, start_time: String(booking.start_time).slice(0, 5),
    end_time: String(booking.end_time).slice(0, 5), ...changes
  };
  if (allowConflict !== undefined) body.allow_conflict = allowConflict;
  return http('PUT', `/${booking.id}`, { role, body });
}

function staffCheckIn(bookingId, { allowConflict, role = 'admin' } = {}) {
  const body = allowConflict !== undefined ? { allow_conflict: allowConflict } : undefined;
  return http('POST', `/${bookingId}/check-in`, { role, body });
}

/** Gọi đúng hàm tool mà AI dùng (không qua Gemini → kết quả xác định). */
function aiTool(name, params) {
  const { executeTool } = require('../routes/bookingCommandsV2');
  if (typeof executeTool !== 'function') throw new Error('routes/bookingCommandsV2 chưa export executeTool');
  return executeTool(name, params, {
    supabase,
    branch_id: ctx.branch.id,
    todayDateStr: TODAY,
    dbBranches: ctx.allBranches,
    canManageStaff: true,
    req: { app: { get: () => () => { } }, auth: { id: 'test-admin', role: 'admin', level: 2 } }
  });
}

function aiCreate({ start, employeeId, serviceName = 'Ý dễ chịu', guests = 1, date = TEST_DATE, name = 'AI' }) {
  const params = { temporary_name: TEST_PREFIX + name, booking_date: date, start_time: start, num_guests: guests, service_id: service(serviceName).id };
  if (employeeId) params.employee_ids = [employeeId];
  return aiTool('create_booking', params);
}

/** Lịch còn hiệu lực trong ngày (mặc định TEST_DATE) của chi nhánh test. */
async function activeBookings(date = TEST_DATE) {
  const { data, error } = await supabase.from('bookings').select('*').eq('booking_date', date).neq('status', 'cancelled');
  if (error) throw error;
  return data;
}

/** Các cặp lịch chồng giờ trên cùng nhân viên hoặc cùng giường. */
function findOverlaps(rows) {
  const pairs = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const overlap = toMin(a.start_time) < toMin(b.end_time) && toMin(b.start_time) < toMin(a.end_time);
      if (!overlap) continue;
      if (a.employee_id && a.employee_id === b.employee_id) pairs.push({ kind: 'employee', a: a.temporary_name, b: b.temporary_name });
      if (a.bed_id && a.bed_id === b.bed_id) pairs.push({ kind: 'bed', a: a.temporary_name, b: b.temporary_name });
    }
  }
  return pairs;
}

async function getSetting(key) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  return data ? data.value : undefined;
}
/** Đổi setting trong lúc chạy fn, rồi trả lại như cũ (xóa nếu trước đó chưa có). */
async function withSetting(key, value, fn) {
  const before = await getSetting(key);
  await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
  try { return await fn(); } finally {
    if (before === undefined) await supabase.from('settings').delete().eq('key', key);
    else await supabase.from('settings').upsert({ key, value: before }, { onConflict: 'key' });
  }
}

/** Đổi ca của 1 nhân viên trong ngày test trong lúc chạy fn, rồi trả lại. */
async function withShift(employeeId, date, start, end, fn) {
  const { data: before } = await supabase.from('employee_schedules').select('*').eq('employee_id', employeeId).eq('date', date).maybeSingle();
  await supabase.from('employee_schedules').upsert(
    { employee_id: employeeId, date, start_time: start, end_time: end, is_day_off: false },
    { onConflict: 'employee_id,date' }
  );
  try { return await fn(); } finally {
    if (before) await supabase.from('employee_schedules').upsert(before, { onConflict: 'employee_id,date' });
    else await supabase.from('employee_schedules').delete().eq('employee_id', employeeId).eq('date', date);
  }
}

/** Chi nhánh khác có nhân viên + giường đang hoạt động (cho test đổi chi nhánh). Ngày test ở đó cũng phải trống lịch thật. */
async function otherBranch() {
  for (const b of ctx.allBranches.filter(x => x.id !== ctx.branch.id)) {
    const { data: employees } = await supabase.from('employees').select('id, name').eq('branch_id', b.id).eq('is_active', true);
    const { data: beds } = await supabase.from('beds').select('id, name').eq('branch_id', b.id).eq('is_active', true);
    if (!employees?.length || !beds?.length) continue;
    const { data: foreign } = await supabase.from('bookings').select('id, temporary_name, client_ip, customers(name)')
      .eq('branch_id', b.id).eq('booking_date', TEST_DATE).neq('status', 'cancelled');
    if ((foreign || []).some(r => !isTestRow(r))) throw new Error(`Ngày ${TEST_DATE} ở ${b.name} đã có lịch thật — đổi TEST_DATE.`);
    return { branch: b, employees, beds };
  }
  throw new Error('Không có chi nhánh thứ 2 có nhân viên + giường để test đổi chi nhánh');
}

/** Tạm tắt mọi giường của chi nhánh trong lúc chạy fn (chi nhánh "không có giường"), rồi bật lại đúng các giường đó. */
async function withBedsInactive(branchId, fn) {
  const { data: beds } = await supabase.from('beds').select('id').eq('branch_id', branchId).eq('is_active', true);
  const ids = (beds || []).map(b => b.id);
  if (ids.length) await supabase.from('beds').update({ is_active: false }).in('id', ids);
  try { return await fn(); } finally {
    if (ids.length) await supabase.from('beds').update({ is_active: true }).in('id', ids);
  }
}

/** Xóa setting trong lúc chạy fn (giả lập "chưa từng cài"), rồi trả lại. */
async function withoutSetting(key, fn) {
  const before = await getSetting(key);
  await supabase.from('settings').delete().eq('key', key);
  try { return await fn(); } finally {
    if (before !== undefined) await supabase.from('settings').upsert({ key, value: before }, { onConflict: 'key' });
  }
}

/** Cho các lịch giữ chỗ hết hạn ngay (cả cách lưu cũ EXPIRES: trong ghi chú lẫn cột hold_expires_at nếu đã có). */
async function expireHolds(ids) {
  const past = Date.now() - 60e3;
  const { data: rows } = await supabase.from('bookings').select('id, internal_note').in('id', ids);
  for (const r of rows || []) {
    const internal_note = String(r.internal_note || '').replace(/EXPIRES:\d+/, `EXPIRES:${past}`);
    const { error } = await supabase.from('bookings').update({ internal_note, hold_expires_at: new Date(past).toISOString() }).eq('id', r.id);
    if (error) await supabase.from('bookings').update({ internal_note }).eq('id', r.id); // chưa chạy migration → chưa có cột
  }
}

module.exports = {
  TEST_PREFIX, TEST_DATE, TODAY, ctx, supabase,
  setup, teardown, cleanup, toMin, toHHMM, vnNowMinutes,
  service, employee, insertFixture, occupyStaff,
  onlineBook, onlineHold, staffBook, staffUpdate, staffCheckIn, aiTool, aiCreate,
  activeBookings, findOverlaps, getSetting, withSetting, withShift,
  otherBranch, withBedsInactive, withoutSetting, expireHolds
};
