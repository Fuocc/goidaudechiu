/**
 * Booking guard — đặc tả bằng test (viết TRƯỚC khi sửa code). Xem ROADMAP.md › "Booking rules".
 *
 *   | Ai đặt               | Buffer | Ca / giường | Được chồng lịch?            |
 *   | Khách online         | có     | có (luôn cần giường) | không bao giờ                          |
 *   | AI                   | không  | có (luôn cần giường) | mặc định không; có sau khi NV xác nhận |
 *   | Nhân viên / admin    | không  | chỉ cảnh báo         | có, sau khi xác nhận                   |
 *
 * 409 BOOKING_CONFLICT → data.conflicts[].type ∈ employee_busy | off_shift | bed_busy | no_employee | no_bed
 * AI bị chặn vì trùng → { success: false, blocked: true, reason, confirm_token } — gửi lại kèm confirm_token mới lưu.
 *
 * Chạy: npm run test:guard   (cần backend/.env — dùng Supabase thật, chỉ ghi dữ liệu TEST-GUARD và tự dọn)
 * KHÔNG sửa test để cho qua: đổi hành vi thì đổi ROADMAP.md trước, rồi mới đổi test.
 */
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./harness');

const T = { timeout: 60000 };
// Số request gửi CÙNG LÚC trong test tranh chấp — đủ nhiều để code không khóa chắc chắn lộ lỗi
const RACERS = [1, 2, 3, 4, 5];
const ok = (r) => r.status === 200 || r.status === 201;
const aiOk = (r) => r?.success === true;
const rowsNamed = (rows, suffix) => rows.filter(b => (b.temporary_name || '') === h.TEST_PREFIX + suffix);

async function assertNoOverlaps(date) {
  const overlaps = h.findOverlaps(await h.activeBookings(date));
  assert.deepEqual(overlaps, [], `Có lịch chồng nhau: ${JSON.stringify(overlaps)}`);
}

before(h.setup);
after(h.teardown);
beforeEach(h.cleanup);

// ---------------------------------------------------------------------------
describe('Khách đặt online', () => {
  test('bị từ chối khi mọi nhân viên đều bận', T, async () => {
    await h.occupyStaff(h.ctx.employees.length, '15:00', '16:00');
    const r = await h.onlineBook({ start: '15:00' });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(rowsNamed(await h.activeBookings(), 'Online').length, 0);
  });

  test('buffer (setting buffer_time) áp dụng sau lịch trước đó', T, async () => {
    await h.withSetting('buffer_time', 20, async () => {
      await h.occupyStaff(h.ctx.employees.length, '14:00', '15:00');
      const inBuffer = await h.onlineBook({ start: '15:10', name: 'Online in buffer' });
      assert.equal(inBuffer.status, 409, 'đặt trong khoảng buffer phải bị từ chối');
      const afterBuffer = await h.onlineBook({ start: '15:20', name: 'Online after buffer' });
      assert.ok(ok(afterBuffer), `đặt sau buffer phải được: ${JSON.stringify(afterBuffer.data)}`);
    });
  });

  test('nhiều khách đặt cùng lúc vào nhân viên trống cuối cùng → chỉ 1 người được', T, async () => {
    await h.occupyStaff(h.ctx.employees.length - 1, '15:00', '16:00');
    const results = await Promise.all(RACERS.map(i => h.onlineBook({ start: '15:00', name: `Race ${i}` })));
    assert.equal(results.filter(ok).length, 1, `status: ${results.map(r => r.status)}`);
    await assertNoOverlaps();
  });

  test('giữ chỗ cùng lúc vào nhân viên trống cuối cùng → chỉ 1 giữ chỗ được', T, async () => {
    await h.occupyStaff(h.ctx.employees.length - 1, '15:00', '16:00');
    const results = await Promise.all(RACERS.map(() => h.onlineHold({ start: '15:00' })));
    assert.equal(results.filter(ok).length, 1, `status: ${results.map(r => r.status)}`);
    await assertNoOverlaps();
  });

  test('nhóm đông hơn số nhân viên trống → từ chối, không tạo lịch dở dang', T, async () => {
    await h.occupyStaff(h.ctx.employees.length - 1, '15:00', '16:00');
    const r = await h.onlineBook({ start: '15:00', guests: 2, name: 'Group' });
    assert.equal(r.status, 409);
    assert.equal(rowsNamed(await h.activeBookings(), 'Group').length, 0);
  });

  test('không lấy giường đang được dùng', T, async () => {
    const n = h.ctx.employees.length;
    await h.occupyStaff(n - 1, '15:00', '16:00');
    await h.insertFixture({ bedId: h.ctx.beds[n - 1].id, start: '15:00', end: '16:00', name: 'Bed only' });
    const r = await h.onlineBook({ start: '15:00' });
    assert.equal(r.status, 409, 'còn nhân viên nhưng hết giường → phải từ chối');
  });
});

// ---------------------------------------------------------------------------
describe('Trợ lý AI', () => {
  test('từ chối nhân viên đã có lịch trùng giờ', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });
    const r = await h.aiCreate({ start: '15:00', employeeId: emp.id });
    assert.equal(aiOk(r), false, JSON.stringify(r));
    assert.equal(rowsNamed(await h.activeBookings(), 'AI').length, 0);
  });

  test('không áp buffer: đặt ngay khi lịch trước kết thúc', T, async () => {
    await h.withSetting('buffer_time', 20, async () => {
      const emp = h.employee(0);
      await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00' });
      const r = await h.aiCreate({ start: '15:00', employeeId: emp.id });
      assert.equal(aiOk(r), true, JSON.stringify(r));
      assert.equal(r.bookings[0].employee_id, emp.id);
    });
  });

  test('xếp giường còn trống cho lịch AI tạo', T, async () => {
    const n = h.ctx.employees.length;
    await h.occupyStaff(n - 1, '15:00', '16:00');
    const r = await h.aiCreate({ start: '15:00' });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal(r.bookings[0].bed_id, h.ctx.beds[n - 1].id, 'phải nhận giường duy nhất còn trống');
    await assertNoOverlaps();
  });

  test('từ chối khi không còn giường trống', T, async () => {
    const n = h.ctx.employees.length;
    await h.occupyStaff(n - 1, '15:00', '16:00');
    await h.insertFixture({ bedId: h.ctx.beds[n - 1].id, start: '15:00', end: '16:00', name: 'Bed only' });
    const r = await h.aiCreate({ start: '15:00' });
    assert.equal(aiOk(r), false, JSON.stringify(r));
  });

  test('tôn trọng giờ ca làm của nhân viên', T, async () => {
    const offShift = h.employee(0);
    await h.withShift(offShift.id, h.TEST_DATE, '09:00', '12:00', async () => {
      const asked = await h.aiCreate({ start: '15:00', employeeId: offShift.id, name: 'AI asked' });
      assert.equal(aiOk(asked), false, `chỉ định NV ngoài ca phải bị từ chối: ${JSON.stringify(asked)}`);

      // Mọi người khác bận → người duy nhất "rảnh" lại đang ngoài ca → phải từ chối
      for (let i = 1; i < h.ctx.employees.length; i++) {
        await h.insertFixture({ employeeId: h.ctx.employees[i].id, bedId: h.ctx.beds[i].id, start: '15:00', end: '16:00', name: `Busy ${i}` });
      }
      const auto = await h.aiCreate({ start: '15:00', name: 'AI auto' });
      assert.equal(aiOk(auto), false, `không được xếp NV ngoài ca: ${JSON.stringify(auto)}`);
    });
  });

  test('2 lệnh AI cùng lúc cho cùng nhân viên → chỉ 1 thành công', T, async () => {
    const emp = h.employee(0);
    for (let round = 1; round <= 3; round++) { // tranh chấp phụ thuộc thời điểm → lặp vài lượt cho chắc
      await h.cleanup();
      const results = await Promise.all(RACERS.map(i => h.aiCreate({ start: '15:00', employeeId: emp.id, name: `AI race ${i}` })));
      assert.equal(results.filter(aiOk).length, 1, `lượt ${round}: ${JSON.stringify(results.map(r => r.success ?? r))}`);
      await assertNoOverlaps();
    }
  });

  test('AI và khách online cùng lúc tranh nhân viên trống cuối cùng → chỉ 1 thành công', T, async () => {
    await h.occupyStaff(h.ctx.employees.length - 1, '15:00', '16:00');
    const [ai1, ai2, web1, web2] = await Promise.all([
      h.aiCreate({ start: '15:00', name: 'AI mixed 1' }), h.aiCreate({ start: '15:00', name: 'AI mixed 2' }),
      h.onlineBook({ start: '15:00', name: 'Web mixed 1' }), h.onlineBook({ start: '15:00', name: 'Web mixed 2' })
    ]);
    const wins = [aiOk(ai1), aiOk(ai2), ok(web1), ok(web2)];
    assert.equal(wins.filter(Boolean).length, 1, `ai/ai/web/web thành công: ${wins}`);
    await assertNoOverlaps();
  });

  test('đổi sang dịch vụ dài hơn không được lấn sang lịch kế tiếp', T, async () => {
    const emp = h.employee(0);
    const created = await h.aiCreate({ start: '15:00', employeeId: emp.id });
    assert.equal(aiOk(created), true, JSON.stringify(created));
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[1].id, start: '16:00', end: '17:00', name: 'Next' });

    const r = await h.aiTool('update_booking', { booking_id: created.bookings[0].id, service_id: h.service('Combo 17').id });
    assert.equal(aiOk(r), false, JSON.stringify(r));
    const row = (await h.activeBookings()).find(b => b.id === created.bookings[0].id);
    assert.equal(String(row.end_time).slice(0, 5), '16:00', 'lịch không được bị kéo dài');
  });

  test('đổi chi nhánh không để lịch mất nhân viên', T, async () => {
    const created = await h.aiCreate({ start: '15:00', employeeId: h.employee(0).id });
    assert.equal(aiOk(created), true, JSON.stringify(created));
    const other = h.ctx.allBranches.find(b => b.id !== h.ctx.branch.id);

    await h.aiTool('update_booking', { booking_id: created.bookings[0].id, branch_id: other.id });
    const row = (await h.activeBookings()).find(b => b.id === created.bookings[0].id);
    assert.ok(row.employee_id, 'sau khi đổi (hoặc từ chối đổi) chi nhánh, lịch vẫn phải có nhân viên');
  });
});

// ---------------------------------------------------------------------------
describe('Nhân viên / admin trên dashboard', () => {
  test('không áp buffer cho lịch nhân viên tạo', T, async () => {
    await h.withSetting('buffer_time', 20, async () => {
      await h.occupyStaff(h.ctx.employees.length, '14:00', '15:00');
      const r = await h.staffBook({ start: '15:00' });
      assert.ok(ok(r), `nhân viên đặt ngay sau lịch trước phải được: ${r.status} ${JSON.stringify(r.data)}`);
    });
  });

  test('giữ đúng nhân viên được chọn: cảnh báo khi bận, không tự đổi người', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });

    const warn = await h.staffBook({ start: '15:00', employeeId: emp.id, name: 'Wants emp0' });
    assert.equal(warn.status, 409, `phải cảnh báo thay vì tự đổi người: ${warn.status} ${JSON.stringify(warn.data)}`);
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    assert.equal(rowsNamed(await h.activeBookings(), 'Wants emp0').length, 0, 'chưa xác nhận thì chưa được lưu');

    const confirmed = await h.staffBook({ start: '15:00', employeeId: emp.id, name: 'Wants emp0', allowConflict: true });
    assert.ok(ok(confirmed), JSON.stringify(confirmed.data));
    const saved = Array.isArray(confirmed.data) ? confirmed.data[0] : confirmed.data;
    assert.equal(saved.employee_id, emp.id, 'sau khi xác nhận phải lưu đúng nhân viên đã chọn');
  });

  test('sửa lịch thành chồng giờ → hỏi trước, xác nhận thì lưu', T, async () => {
    const [a, b] = [h.employee(0), h.employee(1)];
    await h.insertFixture({ employeeId: a.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00', name: 'A' });
    const moving = await h.insertFixture({ employeeId: b.id, bedId: h.ctx.beds[1].id, start: '15:00', end: '16:00', name: 'B' });

    const warn = await h.staffUpdate(moving, { employee_id: a.id });
    assert.equal(warn.status, 409);
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');

    const confirmed = await h.staffUpdate(moving, { employee_id: a.id }, { allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.employee_id, a.id);
  });

  test('chỉ sửa ghi chú trên lịch vốn đã chồng giờ → lưu thẳng, không hỏi', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00', name: 'First' });
    const overlapping = await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[1].id, start: '15:30', end: '16:30', name: 'Second' });

    const r = await h.staffUpdate(overlapping, { notes: 'Ghi chú mới' });
    assert.equal(r.status, 200, `sửa ghi chú không được hỏi trùng lịch: ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data.notes, 'Ghi chú mới');
    const row = (await h.activeBookings()).find(b => b.id === overlapping.id);
    assert.equal(row.notes, 'Ghi chú mới');
  });

  test('sửa lịch kèm thông tin khách nhưng bị trùng → khách giữ nguyên; xác nhận thì lưu cả hai, trả về oldBooking', T, async () => {
    const [a, b] = [h.employee(0), h.employee(1)];
    const { data: customer, error: custErr } = await h.supabase.from('customers')
      .insert({ name: h.TEST_PREFIX + 'Mia', phone: `0999${String(Date.now()).slice(-6)}` }).select('*').single();
    if (custErr) throw custErr;
    await h.insertFixture({ employeeId: a.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00', name: 'A' });
    const fixture = await h.insertFixture({ employeeId: b.id, bedId: h.ctx.beds[1].id, start: '15:00', end: '16:00', name: 'Mia booking' });
    const { data: moving } = await h.supabase.from('bookings').update({ customer_id: customer.id }).eq('id', fixture.id).select('*').single();

    const customer_update = { name: h.TEST_PREFIX + 'Mia mới', phone: customer.phone, email: null, habits: 'Thích nước ấm' };
    const warn = await h.staffUpdate(moving, { employee_id: a.id, customer_update });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    const { data: afterWarn } = await h.supabase.from('customers').select('name, habits').eq('id', customer.id).single();
    assert.equal(afterWarn.name, h.TEST_PREFIX + 'Mia', 'bị chặn vì trùng thì thông tin khách phải được hoàn lại');
    assert.equal(afterWarn.habits, null);

    const confirmed = await h.staffUpdate(moving, { employee_id: a.id, customer_update }, { allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.employee_id, a.id);
    assert.equal(confirmed.data.oldBooking?.employee_id, b.id, 'response phải có oldBooking (trạng thái trước khi sửa)');
    assert.deepEqual(confirmed.data.group_updated_ids, []);
    const { data: afterSave } = await h.supabase.from('customers').select('name, habits').eq('id', customer.id).single();
    assert.equal(afterSave.name, h.TEST_PREFIX + 'Mia mới');
    assert.equal(afterSave.habits, 'Thích nước ấm');
  });

  // Check-in dùng giờ hiện tại → test chạy trên ngày hôm nay, chỉ trong giờ mở cửa
  const nowMin = h.vnNowMinutes();
  const checkInSkip = nowMin < 10 * 60 + 30 || nowMin > 20 * 60 ? 'chỉ chạy được trong khoảng 10:30–20:00 giờ VN' : false;

  test('khách đến trễ: check-in chồng lên lịch kế tiếp → hỏi trước, xác nhận thì check-in', { ...T, skip: checkInSkip }, async () => {
    const emp = h.employee(0);
    const start = Math.floor((nowMin - 60) / 5) * 5;
    const late = await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), name: 'Late' });
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[1].id, date: h.TODAY, start: h.toHHMM(nowMin + 15), end: h.toHHMM(nowMin + 75), name: 'Next' });

    const warn = await h.staffCheckIn(late.id);
    assert.equal(warn.status, 409, `phải cảnh báo trước khi check-in chồng lịch: ${warn.status} ${JSON.stringify(warn.data)}`);
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    let row = (await h.activeBookings(h.TODAY)).find(b => b.id === late.id);
    assert.equal(row.status, 'confirmed', 'chưa xác nhận thì chưa check-in');

    const confirmed = await h.staffCheckIn(late.id, { allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    row = (await h.activeBookings(h.TODAY)).find(b => b.id === late.id);
    assert.equal(row.status, 'arrived');
  });

  test('check-in không chồng lịch → vào thẳng', { ...T, skip: checkInSkip }, async () => {
    const emp = h.employee(0);
    const start = Math.floor((nowMin - 10) / 5) * 5;
    const b = await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), name: 'On time' });
    const r = await h.staffCheckIn(b.id);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });

  test('setting confirm_staff_overlap = false → nhân viên lưu chồng lịch không cần hỏi', T, async () => {
    await h.withSetting('confirm_staff_overlap', false, async () => {
      const emp = h.employee(0);
      await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });
      const created = await h.staffBook({ start: '15:00', employeeId: emp.id, name: 'No confirm' });
      assert.ok(ok(created), `${created.status} ${JSON.stringify(created.data)}`);
      const saved = Array.isArray(created.data) ? created.data[0] : created.data;
      assert.equal(saved.employee_id, emp.id);

      const other = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, start: '15:00', end: '16:00', name: 'Other' });
      const moved = await h.staffUpdate(other, { employee_id: emp.id });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
    });
  });
});

// ---------------------------------------------------------------------------
// Quyết định 19/10 (ROADMAP.md › Booking rules) — viết trước khi sửa code
const conflictTypes = (r) => (r.data?.conflicts || []).map(c => c.type);
const savedRow = (r) => (Array.isArray(r.data) ? r.data[0] : r.data);
const aiCreateWithToken = ({ start, employeeId, name, token }) => h.aiTool('create_booking', {
  temporary_name: h.TEST_PREFIX + name, booking_date: h.TEST_DATE, start_time: start, num_guests: 1,
  service_id: h.service('Ý dễ chịu').id, employee_ids: [employeeId], confirm_token: token
});

describe('Buffer: 0 = không buffer, chưa cài = 0', () => {
  test('buffer_time = 0 → khách online đặt ngay khi lịch trước kết thúc', T, async () => {
    await h.withSetting('buffer_time', 0, async () => {
      await h.occupyStaff(h.ctx.employees.length, '14:00', '15:00');
      const r = await h.onlineBook({ start: '15:00' });
      assert.ok(ok(r), `${r.status} ${JSON.stringify(r.data)}`);
    });
  });

  test('chưa cài buffer_time → không có buffer', T, async () => {
    await h.withoutSetting('buffer_time', async () => {
      await h.occupyStaff(h.ctx.employees.length, '14:00', '15:00');
      const r = await h.onlineBook({ start: '15:00' });
      assert.ok(ok(r), `${r.status} ${JSON.stringify(r.data)}`);
    });
  });
});

describe('Luôn cần giường (online + AI)', () => {
  test('chi nhánh không có giường → khách online bị từ chối', T, async () => {
    await h.withBedsInactive(h.ctx.branch.id, async () => {
      const r = await h.onlineBook({ start: '15:00', name: 'Online no bed' });
      assert.equal(r.status, 409, JSON.stringify(r.data));
      assert.equal(rowsNamed(await h.activeBookings(), 'Online no bed').length, 0);
    });
  });

  test('chi nhánh không có giường → AI bị từ chối', T, async () => {
    await h.withBedsInactive(h.ctx.branch.id, async () => {
      const r = await h.aiCreate({ start: '15:00', name: 'AI no bed' });
      assert.equal(aiOk(r), false, JSON.stringify(r));
      assert.equal(rowsNamed(await h.activeBookings(), 'AI no bed').length, 0);
    });
  });
});

describe('Giữ chỗ hết hạn', () => {
  test('giữ chỗ đã hết hạn không còn chặn slot (không cần chờ lần giữ chỗ kế tiếp dọn)', T, async () => {
    await h.occupyStaff(h.ctx.employees.length - 1, '15:00', '16:00');
    const hold = await h.onlineHold({ start: '15:00' });
    assert.ok(ok(hold), JSON.stringify(hold.data));
    await h.expireHolds(hold.data.hold_ids);
    const r = await h.onlineBook({ start: '15:00', name: 'After expired hold' });
    assert.ok(ok(r), `giữ chỗ hết hạn vẫn chặn: ${r.status} ${JSON.stringify(r.data)}`);
  });
});

describe('Nhân viên: cảnh báo đủ lý do, cùng 1 xác nhận', () => {
  test('không chọn NV và không ai rảnh → cảnh báo, xác nhận thì lưu chưa xếp NV', T, async () => {
    await h.occupyStaff(h.ctx.employees.length, '15:00', '16:00');
    const warn = await h.staffBook({ start: '15:00', name: 'Unassigned' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    assert.ok(conflictTypes(warn).includes('no_employee'), JSON.stringify(warn.data));
    assert.equal(rowsNamed(await h.activeBookings(), 'Unassigned').length, 0);

    const confirmed = await h.staffBook({ start: '15:00', name: 'Unassigned', allowConflict: true });
    assert.ok(ok(confirmed), JSON.stringify(confirmed.data));
    assert.equal(savedRow(confirmed).employee_id, null, 'không ai rảnh → lưu chưa xếp NV, không chồng lên ai');
  });

  test('chọn NV ngoài ca → cảnh báo off_shift, xác nhận thì lưu đúng NV', T, async () => {
    const emp = h.employee(0);
    await h.withShift(emp.id, h.TEST_DATE, '09:00', '12:00', async () => {
      const warn = await h.staffBook({ start: '15:00', employeeId: emp.id, name: 'Off shift' });
      assert.equal(warn.status, 409, JSON.stringify(warn.data));
      assert.ok(conflictTypes(warn).includes('off_shift'), JSON.stringify(warn.data));

      const confirmed = await h.staffBook({ start: '15:00', employeeId: emp.id, name: 'Off shift', allowConflict: true });
      assert.ok(ok(confirmed), JSON.stringify(confirmed.data));
      assert.equal(savedRow(confirmed).employee_id, emp.id);
    });
  });

  test('NV bận → loại cảnh báo employee_busy', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });
    const warn = await h.staffBook({ start: '15:00', employeeId: emp.id, name: 'Busy type' });
    assert.equal(warn.status, 409);
    assert.ok(conflictTypes(warn).includes('employee_busy'), JSON.stringify(warn.data));
  });

  test('hết giường trống → cảnh báo no_bed, xác nhận thì lưu', T, async () => {
    for (const bed of h.ctx.beds) await h.insertFixture({ bedId: bed.id, start: '15:00', end: '16:00', name: `Bed ${bed.name}` });
    const warn = await h.staffBook({ start: '15:00', name: 'No bed' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.ok(conflictTypes(warn).includes('no_bed'), JSON.stringify(warn.data));

    const confirmed = await h.staffBook({ start: '15:00', name: 'No bed', allowConflict: true });
    assert.ok(ok(confirmed), JSON.stringify(confirmed.data));
  });

  // ROADMAP 19/10: dời lịch mà giường cũ bận → tự lấy giường trống khác; chỉ cảnh báo khi hết giường
  test('dời lịch sang giờ giường cũ đang được dùng → tự đổi sang giường trống, không hỏi', T, async () => {
    const bed = h.ctx.beds[0];
    await h.insertFixture({ employeeId: h.employee(0).id, bedId: bed.id, start: '15:00', end: '16:00', name: 'On bed' });
    const moving = await h.insertFixture({ employeeId: h.employee(1).id, bedId: bed.id, start: '13:00', end: '14:00', name: 'Moving' });

    const r = await h.staffUpdate(moving, { start_time: '15:00', end_time: '16:00' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.bed_id && r.data.bed_id !== bed.id, `phải sang giường khác: ${r.data.bed_id}`);
    await assertNoOverlaps();
  });

  test('dời lịch sang giờ hết giường trống → cảnh báo no_bed, xác nhận thì lưu', T, async () => {
    for (const b of h.ctx.beds) await h.insertFixture({ bedId: b.id, start: '15:00', end: '16:00', name: `Bed ${b.name}` });
    const moving = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[0].id, start: '13:00', end: '14:00', name: 'Moving' });

    const warn = await h.staffUpdate(moving, { start_time: '15:00', end_time: '16:00' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.ok(conflictTypes(warn).includes('no_bed'), JSON.stringify(warn.data));

    const confirmed = await h.staffUpdate(moving, { start_time: '15:00', end_time: '16:00' }, { allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  });
});

describe('AI: xác nhận chồng lịch bằng token một lần', () => {
  test('bị chặn → có confirm_token → gửi lại kèm token thì lưu đúng NV; token không dùng lại được', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });

    const blocked = await h.aiCreate({ start: '15:00', employeeId: emp.id, name: 'AI confirm' });
    assert.equal(aiOk(blocked), false, JSON.stringify(blocked));
    assert.equal(typeof blocked.confirm_token, 'string', `phải trả confirm_token: ${JSON.stringify(blocked)}`);
    assert.equal(rowsNamed(await h.activeBookings(), 'AI confirm').length, 0, 'chưa xác nhận thì chưa lưu');

    const confirmed = await aiCreateWithToken({ start: '15:00', employeeId: emp.id, name: 'AI confirm', token: blocked.confirm_token });
    assert.equal(aiOk(confirmed), true, JSON.stringify(confirmed));
    assert.equal(confirmed.bookings[0].employee_id, emp.id);

    const reused = await aiCreateWithToken({ start: '15:00', employeeId: emp.id, name: 'AI confirm', token: blocked.confirm_token });
    assert.equal(aiOk(reused), false, `token đã dùng không được lưu lần 2: ${JSON.stringify(reused)}`);
    assert.equal(rowsNamed(await h.activeBookings(), 'AI confirm').length, 1);
  });

  test('token chỉ đúng cho thay đổi đã hỏi: đổi giờ thì token không còn hiệu lực', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });
    const blocked = await h.aiCreate({ start: '15:00', employeeId: emp.id, name: 'AI token swap' });
    assert.equal(typeof blocked.confirm_token, 'string', JSON.stringify(blocked));

    const swapped = await aiCreateWithToken({ start: '15:30', employeeId: emp.id, name: 'AI token swap', token: blocked.confirm_token });
    assert.equal(aiOk(swapped), false, JSON.stringify(swapped));
    assert.equal(rowsNamed(await h.activeBookings(), 'AI token swap').length, 0);
  });

  test('token giả → không lưu', T, async () => {
    const emp = h.employee(0);
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });
    const r = await aiCreateWithToken({ start: '15:00', employeeId: emp.id, name: 'AI fake', token: 'fake-token' });
    assert.equal(aiOk(r), false, JSON.stringify(r));
    assert.equal(rowsNamed(await h.activeBookings(), 'AI fake').length, 0);
  });

  test('confirm_staff_overlap = false → AI lưu chồng lịch không cần hỏi (như lịch)', T, async () => {
    await h.withSetting('confirm_staff_overlap', false, async () => {
      const emp = h.employee(0);
      await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00' });
      const r = await h.aiCreate({ start: '15:00', employeeId: emp.id, name: 'AI no confirm' });
      assert.equal(aiOk(r), true, JSON.stringify(r));
      assert.equal(r.bookings[0].employee_id, emp.id);
    });
  });

  const nowMin = h.vnNowMinutes();
  const checkInSkip = nowMin < 10 * 60 + 30 || nowMin > 20 * 60 ? 'chỉ chạy được trong khoảng 10:30–20:00 giờ VN' : false;

  test('AI check-in trễ chồng lịch kế tiếp → chặn + token, xác nhận thì check-in', { ...T, skip: checkInSkip }, async () => {
    const emp = h.employee(0);
    const start = Math.floor((nowMin - 60) / 5) * 5;
    const late = await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[0].id, date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), name: 'AI late' });
    await h.insertFixture({ employeeId: emp.id, bedId: h.ctx.beds[1].id, date: h.TODAY, start: h.toHHMM(nowMin + 15), end: h.toHHMM(nowMin + 75), name: 'AI next' });

    const blocked = await h.aiTool('check_in_booking', { booking_id: late.id });
    assert.equal(aiOk(blocked), false, JSON.stringify(blocked));
    assert.equal(typeof blocked.confirm_token, 'string', JSON.stringify(blocked));
    let row = (await h.activeBookings(h.TODAY)).find(b => b.id === late.id);
    assert.equal(row.status, 'confirmed');

    const confirmed = await h.aiTool('check_in_booking', { booking_id: late.id, confirm_token: blocked.confirm_token });
    assert.equal(aiOk(confirmed), true, JSON.stringify(confirmed));
    row = (await h.activeBookings(h.TODAY)).find(b => b.id === late.id);
    assert.equal(row.status, 'arrived');
  });
});

describe('AI đổi chi nhánh', () => {
  test('chi nhánh mới còn người + giường → xếp lại NV và giường của chi nhánh mới', T, async () => {
    const other = await h.otherBranch();
    const created = await h.aiCreate({ start: '15:00', employeeId: h.employee(0).id, name: 'AI move ok' });
    assert.equal(aiOk(created), true, JSON.stringify(created));

    const r = await h.aiTool('update_booking', { booking_id: created.bookings[0].id, branch_id: other.branch.id });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    const row = (await h.activeBookings()).find(b => b.id === created.bookings[0].id);
    assert.equal(row.branch_id, other.branch.id);
    assert.ok(other.employees.some(e => e.id === row.employee_id), `NV phải thuộc chi nhánh mới: ${row.employee_id}`);
    assert.ok(other.beds.some(b => b.id === row.bed_id), `giường phải thuộc chi nhánh mới: ${row.bed_id}`);
    await assertNoOverlaps();
  });

  test('chi nhánh mới hết người → từ chối, lịch giữ nguyên', T, async () => {
    const other = await h.otherBranch();
    for (let i = 0; i < other.employees.length; i++) {
      await h.insertFixture({ branchId: other.branch.id, employeeId: other.employees[i].id, bedId: other.beds[i]?.id ?? null, start: '15:00', end: '16:00', name: `Other busy ${i}` });
    }
    const created = await h.aiCreate({ start: '15:00', employeeId: h.employee(0).id, name: 'AI move full' });
    assert.equal(aiOk(created), true, JSON.stringify(created));
    const before = created.bookings[0];

    const r = await h.aiTool('update_booking', { booking_id: before.id, branch_id: other.branch.id });
    assert.equal(aiOk(r), false, JSON.stringify(r));
    const row = (await h.activeBookings()).find(b => b.id === before.id);
    assert.equal(row.branch_id, h.ctx.branch.id, 'lịch phải ở lại chi nhánh cũ');
    assert.equal(row.employee_id, before.employee_id);
    assert.equal(row.bed_id, before.bed_id);
  });
});

// #10 — ROADMAP › "Group rules", ADR 0001: nhân viên dời nhóm, hỏi "Cả nhóm / Chỉ khách này"
describe('Nhân viên dời nhóm khách', () => {
  // A 14:00–15:00 (NV 0), B 14:30–16:00 (NV 1), cùng nhóm
  async function groupOfTwo() {
    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Group A', groupId });
    const b = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, start: '14:30', end: '16:00', name: 'Group B', groupId });
    return { a, b };
  }
  const rowOf = async (id) => (await h.activeBookings()).find(r => r.id === id);
  const hhmm = (t) => String(t).slice(0, 5);

  test('đổi giờ lịch trong nhóm mà không gửi scope → 409 SCOPE_REQUIRED kèm số khách, không lưu gì', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.staffUpdate(a, { start_time: '16:00', end_time: '17:00' });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data?.code, 'SCOPE_REQUIRED');
    assert.equal(r.data?.group_size, 2);
    assert.equal(hhmm((await rowOf(a.id)).start_time), '14:00');
    assert.equal(hhmm((await rowOf(b.id)).start_time), '14:30');
  });
  test('Cả nhóm dời giờ (A 14:00, B 14:30 → 16:00) → cả hai bắt đầu 16:00, mỗi người giữ giờ kết thúc theo thời lượng của mình', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.staffUpdate(a, { start_time: '16:00', end_time: '17:00', scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.group_updated_ids, [b.id]);
    const [rowA, rowB] = [await rowOf(a.id), await rowOf(b.id)];
    assert.equal(hhmm(rowA.start_time), '16:00');
    assert.equal(hhmm(rowA.end_time), '17:00');
    assert.equal(hhmm(rowB.start_time), '16:00');
    assert.equal(hhmm(rowB.end_time), '17:30');
    assert.equal(rowB.employee_id, h.employee(1).id, 'B giữ NV của mình');
    await assertNoOverlaps();
  });
  test('Chỉ khách này → chỉ A dời, B giữ nguyên', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.staffUpdate(a, { start_time: '16:00', end_time: '17:00', scope: 'booking' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.group_updated_ids, []);
    assert.equal(hhmm((await rowOf(a.id)).start_time), '16:00');
    const rowB = await rowOf(b.id);
    assert.equal(hhmm(rowB.start_time), '14:30');
    assert.equal(hhmm(rowB.end_time), '16:00');
    assert.equal(rowB.group_booking_id, a.group_booking_id, 'B vẫn trong nhóm');
  });

  test('Cả nhóm dời giờ mà NV của B bận → không lưu gì, vướng mắc ghi cho B; gửi lại kèm allow_conflict → lưu cả hai', T, async () => {
    const { a, b } = await groupOfTwo();
    await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[2].id, start: '16:30', end: '17:30', name: 'B busy' });

    const warn = await h.staffUpdate(a, { start_time: '16:00', end_time: '17:00', scope: 'group' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    const busy = (warn.data.conflicts || []).filter(c => c.type === 'employee_busy');
    assert.ok(busy.length && busy.every(c => c.ref === b.id), JSON.stringify(warn.data.conflicts));
    assert.equal(hhmm((await rowOf(a.id)).start_time), '14:00', 'không lưu nửa vời: A giữ nguyên');
    assert.equal(hhmm((await rowOf(b.id)).start_time), '14:30');

    const confirmed = await h.staffUpdate(a, { start_time: '16:00', end_time: '17:00', scope: 'group' }, { allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(hhmm((await rowOf(a.id)).start_time), '16:00');
    const rowB = await rowOf(b.id);
    assert.equal(hhmm(rowB.start_time), '16:00');
    assert.equal(rowB.employee_id, h.employee(1).id, 'xác nhận thì giữ đúng NV của B');
  });
});

// ---------------------------------------------------------------------------
// Giờ nhận khách muộn nhất (Last booking time = `close` của chi nhánh) — ROADMAP.md › "Time limits"
describe('Giờ nhận khách muộn nhất + nửa đêm', () => {
  const LONG = 'Ý ngủ một giấc'; // 90 phút
  const closingAt20 = (fn) => h.withHours(h.ctx.branch.id, { close: '20:00' }, fn);
  const types = (r) => (r.data?.conflicts || r.conflicts || []).map(c => c.type);

  test('khách online: 19:30 dịch vụ 90 phút đặt được dù kết thúc sau 20:00; 20:15 bị từ chối', T, () => closingAt20(async () => {
    const early = await h.onlineBook({ start: '19:30', serviceName: LONG, name: 'Online 1930' });
    assert.equal(ok(early), true, JSON.stringify(early.data));

    const late = await h.onlineBook({ start: '20:15', serviceName: LONG, name: 'Online 2015' });
    assert.equal(late.status, 409, JSON.stringify(late.data));
    assert.deepEqual(types(late), ['after_last_booking']);
    assert.equal(rowsNamed(await h.activeBookings(), 'Online 2015').length, 0);
  }));

  test('giữ chỗ online sau Last booking time → từ chối', T, () => closingAt20(async () => {
    const late = await h.onlineHold({ start: '20:15', serviceName: LONG });
    assert.equal(late.status, 409, JSON.stringify(late.data));
    assert.deepEqual(types(late), ['after_last_booking']);
  }));

  test('lịch trống online mở giờ bắt đầu tới đúng 20:00 (kể cả kết thúc sau đó), không mở 20:15', T, () => closingAt20(async () => {
    const starts = await h.availableStarts({ serviceName: LONG });
    assert.ok(starts.includes('19:30'), `thiếu 19:30: ${starts.join(', ')}`);
    assert.ok(starts.includes('20:00'), `thiếu 20:00: ${starts.join(', ')}`);
    assert.ok(!starts.includes('20:15'), `không được mở 20:15: ${starts.join(', ')}`);
  }));

  test('nhân viên dời lịch sang sau 20:00 → BOOKING_CONFLICT after_last_booking; allow_conflict → lưu', T, () => closingAt20(async () => {
    const moving = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00', name: 'Move late' });

    const warn = await h.staffUpdate(moving, { start_time: '20:15', end_time: '21:15' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.equal(warn.data.code, 'BOOKING_CONFLICT');
    assert.deepEqual(types(warn), ['after_last_booking']);
    assert.match(warn.data.conflicts[0].message, /Quá giờ nhận khách/);

    const saved = await h.staffUpdate(moving, { start_time: '20:15', end_time: '21:15' }, { allowConflict: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(String(saved.data.start_time).slice(0, 5), '20:15');
  }));

  test('nhân viên tạo lịch sau 20:00 → hỏi "Vẫn lưu?"; xác nhận thì lưu', T, () => closingAt20(async () => {
    const warn = await h.staffBook({ start: '20:15', name: 'Staff late' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.deepEqual(types(warn), ['after_last_booking']);

    const saved = await h.staffBook({ start: '20:15', name: 'Staff late', allowConflict: true });
    assert.equal(ok(saved), true, JSON.stringify(saved.data));
    assert.equal(rowsNamed(await h.activeBookings(), 'Staff late').length, 1);
  }));

  test('AI tạo lịch sau 20:00 → chặn + confirm_token; gửi lại kèm token thì lưu', T, () => closingAt20(async () => {
    const emp = h.employee(0);
    const blocked = await h.aiCreate({ start: '20:15', employeeId: emp.id, name: 'AI late' });
    assert.equal(aiOk(blocked), false, JSON.stringify(blocked));
    assert.deepEqual(types(blocked), ['after_last_booking']);
    assert.equal(typeof blocked.confirm_token, 'string', `phải trả confirm_token: ${JSON.stringify(blocked)}`);

    const saved = await aiCreateWithToken({ start: '20:15', employeeId: emp.id, name: 'AI late', token: blocked.confirm_token });
    assert.equal(aiOk(saved), true, JSON.stringify(saved));
    assert.equal(rowsNamed(await h.activeBookings(), 'AI late').length, 1);
  }));

  test('chỉ đổi NV trên lịch đã bắt đầu sau 20:00 → lưu thẳng, không hỏi lại giờ nhận khách (cả lịch trong nhóm)', T, () => closingAt20(async () => {
    const late = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '20:15', end: '21:15', name: 'Late regular' });
    const single = await h.staffUpdate(late, { employee_id: h.employee(1).id });
    assert.equal(single.status, 200, JSON.stringify(single.data));

    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: h.employee(2).id, bedId: h.ctx.beds[1].id, start: '20:15', end: '21:15', name: 'Late group A', groupId });
    await h.insertFixture({ employeeId: h.employee(3).id, bedId: h.ctx.beds[2].id, start: '20:15', end: '21:15', name: 'Late group B', groupId });
    const group = await h.staffUpdate(a, { employee_id: h.employee(4).id });
    assert.equal(group.status, 200, JSON.stringify(group.data));
    assert.equal(group.data.employee_id, h.employee(4).id);
  }));

  test('lịch vượt qua nửa đêm → từ chối hẳn, allow_conflict cũng không lưu', T, async () => {
    const refused = await h.staffBook({ start: '23:00', serviceName: LONG, name: 'Midnight', allowConflict: true });
    assert.equal(refused.status, 400, JSON.stringify(refused.data));
    assert.equal(refused.data.code, 'CROSSES_MIDNIGHT');
    assert.equal(rowsNamed(await h.activeBookings(), 'Midnight').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Check-in một khách hoặc cả nhóm + Late arrival grace (#14) — ROADMAP.md › "Group rules", "Time limits"
describe('Check-in nhóm khách + Late arrival grace', () => {
  const nowMin = h.vnNowMinutes();
  const checkInSkip = nowMin < 10 * 60 + 30 || nowMin > 20 * 60 ? 'chỉ chạy được trong khoảng 10:30–20:00 giờ VN' : false;
  const S = { ...T, skip: checkInSkip };
  const rowOf = async (id) => (await h.activeBookings(h.TODAY)).find(r => r.id === id);
  const hhmm = (t) => String(t).slice(0, 5);

  // A (NV 0) và B (NV 1) cùng nhóm, đặt 10 phút trước, hôm nay
  async function arrivingGroup() {
    const groupId = crypto.randomUUID();
    const start = Math.floor((nowMin - 10) / 5) * 5;
    const at = { date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), groupId };
    const a = await h.insertFixture({ ...at, employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, name: 'Arrive A' });
    const b = await h.insertFixture({ ...at, employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, name: 'Arrive B' });
    return { a, b };
  }

  test('nhân viên check-in lịch trong nhóm mà không gửi scope → 409 SCOPE_REQUIRED kèm số khách, không check-in ai', S, async () => {
    const { a, b } = await arrivingGroup();
    const r = await h.staffCheckIn(a.id);
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data?.code, 'SCOPE_REQUIRED');
    assert.equal(r.data?.group_size, 2);
    assert.equal((await rowOf(a.id)).status, 'confirmed');
    assert.equal((await rowOf(b.id)).status, 'confirmed');
  });

  test('Chỉ khách này → chỉ A arrived với giờ bắt đầu mới, B giữ nguyên và vẫn trong nhóm', S, async () => {
    const { a, b } = await arrivingGroup();
    const r = await h.staffCheckIn(a.id, { scope: 'booking' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const [rowA, rowB] = [await rowOf(a.id), await rowOf(b.id)];
    assert.equal(rowA.status, 'arrived');
    assert.equal(hhmm(rowA.start_time), r.data.start_time);
    assert.equal(rowB.status, 'confirmed');
    assert.equal(hhmm(rowB.start_time), hhmm(b.start_time));
    assert.equal(rowB.group_booking_id, a.group_booking_id);
  });

  test('nhân viên Cả nhóm → cả hai arrived, cùng giờ bắt đầu', S, async () => {
    const { a, b } = await arrivingGroup();
    const r = await h.staffCheckIn(a.id, { scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (const id of [a.id, b.id]) {
      const row = await rowOf(id);
      assert.equal(row.status, 'arrived');
      assert.equal(hhmm(row.start_time), r.data.start_time);
    }
  });

  test('AI check-in lịch trong nhóm (không nói khách nào) → cả nhóm arrived', S, async () => {
    const { a, b } = await arrivingGroup();
    const r = await h.aiTool('check_in_booking', { booking_id: a.id });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal((await rowOf(a.id)).status, 'arrived');
    assert.equal((await rowOf(b.id)).status, 'arrived');
  });

  test('AI check-in scope booking → chỉ khách đó arrived', S, async () => {
    const { a, b } = await arrivingGroup();
    const r = await h.aiTool('check_in_booking', { booking_id: a.id, scope: 'booking' });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal((await rowOf(a.id)).status, 'arrived');
    assert.equal((await rowOf(b.id)).status, 'confirmed');
  });

  // Last booking time = 60 phút trước → check-in bây giờ trễ hơn grace 15 phút
  const closedAnHourAgo = (fn) => h.withHours(h.ctx.branch.id, { open: '06:00', close: h.toHHMM(Math.floor((nowMin - 60) / 5) * 5) }, fn);
  async function soloArrival(name) {
    const start = Math.floor((nowMin - 70) / 5) * 5;
    return h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), name });
  }

  test('check-in muộn hơn Last booking time + grace → hỏi "Vẫn lưu?" (late_check_in); allow_conflict → check-in', S, () => closedAnHourAgo(async () => {
    const b = await soloArrival('Late grace');
    const warn = await h.staffCheckIn(b.id);
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.deepEqual((warn.data.conflicts || []).map(c => c.type), ['late_check_in']);
    assert.equal((await rowOf(b.id)).status, 'confirmed');

    const confirmed = await h.staffCheckIn(b.id, { allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal((await rowOf(b.id)).status, 'arrived');
  }));

  test('late_arrival_grace = 120 → cùng giờ đó check-in vào thẳng', S, () => closedAnHourAgo(() => h.withSetting('late_arrival_grace', 120, async () => {
    const b = await soloArrival('Within grace');
    const r = await h.staffCheckIn(b.id);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await rowOf(b.id)).status, 'arrived');
  })));
});

// ---------------------------------------------------------------------------
// #12 — ROADMAP › "Group rules": dịch vụ, chi nhánh, ghi chú, khách đặt áp cho cả nhóm
describe('Nhân viên đổi field áp cho cả nhóm', () => {
  // A 14:00–15:00 (NV 0), B 14:30–16:00 (NV 1), cùng nhóm
  async function groupOfTwo({ customerId = null, employeeA = h.employee(0).id } = {}) {
    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: employeeA, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Group A', groupId, customerId });
    const b = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, start: '14:30', end: '16:00', name: 'Group B', groupId, customerId });
    return { a, b };
  }
  const rowOf = async (id) => (await h.activeBookings()).find(r => r.id === id);
  const hhmm = (t) => String(t).slice(0, 5);

  test('Cả nhóm đổi dịch vụ → mọi khách dịch vụ mới, giờ kết thúc = giờ bắt đầu của từng người + thời lượng mới', T, async () => {
    const combo = h.service('Combo dễ chịu'); // 100 phút
    const { a, b } = await groupOfTwo();
    const r = await h.staffUpdate(a, { service_id: combo.id, end_time: h.toHHMM(h.toMin('14:00') + combo.duration_minutes), scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const [rowA, rowB] = [await rowOf(a.id), await rowOf(b.id)];
    assert.equal(rowA.service_id, combo.id);
    assert.equal(rowB.service_id, combo.id);
    assert.equal(hhmm(rowA.end_time), '15:40');
    assert.equal(hhmm(rowB.start_time), '14:30');
    assert.equal(hhmm(rowB.end_time), '16:10');
    assert.equal(rowB.employee_id, h.employee(1).id, 'B giữ NV của mình');
    await assertNoOverlaps();
  });

  test('Cả nhóm đổi chi nhánh → NV làm ở chi nhánh mới + rảnh thì giữ, không thì xếp người khác ở đó; giường của chi nhánh mới', T, async () => {
    const other = await h.otherBranch();
    assert.ok(other.employees.length >= 2 && other.beds.length >= 2, 'chi nhánh thứ 2 cần ≥ 2 NV + 2 giường');
    // A đang do NV của chi nhánh kia làm (NV đó rảnh); B do NV của chi nhánh test làm
    const { a, b } = await groupOfTwo({ employeeA: other.employees[0].id });
    const r = await h.staffUpdate(a, { branch_id: other.branch.id, scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const [rowA, rowB] = [await rowOf(a.id), await rowOf(b.id)];
    assert.equal(rowA.branch_id, other.branch.id);
    assert.equal(rowB.branch_id, other.branch.id);
    assert.equal(rowA.employee_id, other.employees[0].id, 'A giữ NV (làm ở chi nhánh mới, rảnh)');
    assert.ok(other.employees.some(e => e.id === rowB.employee_id), `B phải được xếp NV của chi nhánh mới: ${rowB.employee_id}`);
    assert.notEqual(rowB.employee_id, rowA.employee_id);
    for (const row of [rowA, rowB]) assert.ok(other.beds.some(x => x.id === row.bed_id), `giường phải thuộc chi nhánh mới: ${row.bed_id}`);
    await assertNoOverlaps();
  });

  test('đổi chi nhánh mà ở đó không ai rảnh → no_employee, không lưu gì; allow_conflict → lưu chưa xếp NV', T, async () => {
    const other = await h.otherBranch();
    // Mọi NV chi nhánh kia bận (không chiếm giường → giường vẫn trống)
    for (const e of other.employees) {
      await h.insertFixture({ branchId: other.branch.id, employeeId: e.id, start: '13:00', end: '17:00', name: `Other busy ${e.name}` });
    }
    const { a, b } = await groupOfTwo();
    const warn = await h.staffUpdate(a, { branch_id: other.branch.id, scope: 'group' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    assert.ok((warn.data.conflicts || []).some(c => c.type === 'no_employee'), JSON.stringify(warn.data.conflicts));
    assert.equal((await rowOf(a.id)).branch_id, h.ctx.branch.id, 'không lưu nửa vời');
    assert.equal((await rowOf(b.id)).branch_id, h.ctx.branch.id);

    const saved = await h.staffUpdate(a, { branch_id: other.branch.id, scope: 'group' }, { allowConflict: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    for (const row of [await rowOf(a.id), await rowOf(b.id)]) {
      assert.equal(row.branch_id, other.branch.id);
      assert.equal(row.employee_id, null, 'chưa xếp NV');
      assert.ok(other.beds.some(x => x.id === row.bed_id), `giường phải thuộc chi nhánh mới: ${row.bed_id}`);
    }
  });

  test('Cả nhóm sửa khách đặt → mọi khách hiện khách đặt mới; Chỉ khách này đổi tên → chỉ khách đó có tên riêng', T, async () => {
    const mia = await h.insertCustomer('Mia');
    const { a, b } = await groupOfTwo({ customerId: mia.id });
    const phone = '0988' + String(Date.now()).slice(-6);
    const all = await h.staffUpdate(a, {
      customer_id: mia.id, temporary_name: null, scope: 'group',
      customer_update: { name: h.TEST_PREFIX + 'Mia Nguyễn', phone, email: '', habits: '' }
    });
    assert.equal(all.status, 200, JSON.stringify(all.data));
    const { data: profile } = await h.supabase.from('customers').select('name, phone').eq('id', mia.id).single();
    assert.equal(profile.name, h.TEST_PREFIX + 'Mia Nguyễn');
    assert.equal(profile.phone, phone);
    for (const row of [await rowOf(a.id), await rowOf(b.id)]) {
      assert.equal(row.customer_id, mia.id);
      assert.equal(row.temporary_name, null);
    }

    const own = await h.staffUpdate(await rowOf(a.id), {
      customer_id: mia.id, temporary_name: null, scope: 'booking',
      customer_update: { name: h.TEST_PREFIX + 'Lan', phone, email: '', habits: '' }
    });
    assert.equal(own.status, 200, JSON.stringify(own.data));
    const [rowA, rowB] = [await rowOf(a.id), await rowOf(b.id)];
    assert.equal(rowA.temporary_name, h.TEST_PREFIX + 'Lan', 'A có tên riêng');
    assert.equal(rowA.customer_id, null);
    assert.equal(rowB.customer_id, mia.id, 'B vẫn là khách của Mia');
    const { data: after } = await h.supabase.from('customers').select('name').eq('id', mia.id).single();
    assert.equal(after.name, h.TEST_PREFIX + 'Mia Nguyễn', 'hồ sơ Mia giữ nguyên');
  });

  test('đổi chi nhánh và để trống NV → tự xếp người rảnh của chi nhánh mới (không lưu chưa xếp NV)', T, async () => {
    const other = await h.otherBranch();
    const { a } = await groupOfTwo();
    const r = await h.staffUpdate(a, { branch_id: other.branch.id, employee_id: null, scope: 'booking' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const rowA = await rowOf(a.id);
    assert.equal(rowA.branch_id, other.branch.id);
    assert.ok(other.employees.some(e => e.id === rowA.employee_id), `A phải được xếp NV của chi nhánh mới: ${rowA.employee_id}`);
  });
});

// ---------------------------------------------------------------------------
// Hủy = status cancelled, đổi trạng thái theo "Cả nhóm / Chỉ khách này" (#13) — ROADMAP.md › "Group rules"
describe('Hủy lịch và đổi trạng thái theo nhóm', () => {
  // A 14:00–15:00 (NV 0), B 14:30–16:00 (NV 1), cùng nhóm
  async function groupOfTwo(status = 'confirmed') {
    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Group A', groupId, status });
    const b = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, start: '14:30', end: '16:00', name: 'Group B', groupId, status });
    return { a, b };
  }
  const hhmm = (t) => String(t).slice(0, 5);

  test('hủy lịch lẻ không cần scope → status cancelled, dòng lịch vẫn còn', T, async () => {
    const solo = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Solo' });
    const r = await h.staffCancel(solo.id);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await h.bookingRow(solo.id))?.status, 'cancelled');
  });

  test('hủy lịch trong nhóm mà không gửi scope → 409 SCOPE_REQUIRED kèm số khách, không hủy ai', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.staffCancel(a.id);
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data?.code, 'SCOPE_REQUIRED');
    assert.equal(r.data?.group_size, 2);
    assert.equal((await h.bookingRow(a.id)).status, 'confirmed');
    assert.equal((await h.bookingRow(b.id)).status, 'confirmed');
  });

  test('Chỉ khách này → lịch đó cancelled (dòng vẫn còn), khách kia giữ nguyên', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.staffCancel(a.id, { scope: 'booking' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const [rowA, rowB] = [await h.bookingRow(a.id), await h.bookingRow(b.id)];
    assert.equal(rowA?.status, 'cancelled', 'dòng lịch vẫn còn, status cancelled');
    assert.equal(rowB.status, 'confirmed');
    assert.equal(hhmm(rowB.start_time), '14:30');
    assert.equal(rowB.num_guests, b.num_guests, 'không ghi lại số khách');
  });

  test('Cả nhóm → mọi khách cancelled; slot trống lại (AI đặt được đúng NV, đúng giờ)', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.staffCancel(a.id, { scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await h.bookingRow(a.id)).status, 'cancelled');
    assert.equal((await h.bookingRow(b.id)).status, 'cancelled');

    const rebook = await h.aiCreate({ start: '14:00', employeeId: h.employee(0).id, name: 'Rebook' });
    assert.equal(aiOk(rebook), true, JSON.stringify(rebook));
  });

  test('AI hủy lịch trong nhóm (mặc định) → cả nhóm cancelled; scope booking → chỉ khách đó', T, async () => {
    const { a, b } = await groupOfTwo();
    const all = await h.aiTool('delete_booking', { booking_id: a.id });
    assert.equal(aiOk(all), true, JSON.stringify(all));
    assert.equal((await h.bookingRow(a.id)).status, 'cancelled');
    assert.equal((await h.bookingRow(b.id)).status, 'cancelled');

    const other = await groupOfTwo();
    const one = await h.aiTool('delete_booking', { booking_id: other.a.id, scope: 'booking' });
    assert.equal(aiOk(one), true, JSON.stringify(one));
    assert.equal((await h.bookingRow(other.a.id)).status, 'cancelled');
    assert.equal((await h.bookingRow(other.b.id)).status, 'confirmed');
  });

  test('Cả nhóm dời giờ sau khi 1 khách đã hủy → khách đã hủy không bị dời, vẫn cancelled', T, async () => {
    const { a, b } = await groupOfTwo();
    const c = await h.insertFixture({ employeeId: h.employee(2).id, bedId: h.ctx.beds[2].id, start: '14:00', end: '15:00', name: 'Group C', groupId: a.group_booking_id });
    assert.equal((await h.staffCancel(c.id, { scope: 'booking' })).status, 200);

    const r = await h.staffUpdate(a, { start_time: '16:00', end_time: '17:00', scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.group_updated_ids, [b.id]);
    const rowC = await h.bookingRow(c.id);
    assert.equal(rowC.status, 'cancelled');
    assert.equal(hhmm(rowC.start_time), '14:00');
  });

  test('đổi trạng thái completed: không scope → SCOPE_REQUIRED; Cả nhóm → cả hai completed', T, async () => {
    const { a, b } = await groupOfTwo();
    const ask = await h.staffStatus(a.id, 'completed');
    assert.equal(ask.status, 409, JSON.stringify(ask.data));
    assert.equal(ask.data?.code, 'SCOPE_REQUIRED');

    const r = await h.staffStatus(a.id, 'completed', { scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await h.bookingRow(a.id)).status, 'completed');
    assert.equal((await h.bookingRow(b.id)).status, 'completed');
  });

  test('khôi phục cả nhóm đã hủy → cả hai confirmed, đúng giờ + NV cũ, có giường', T, async () => {
    const { a, b } = await groupOfTwo('cancelled');
    const r = await h.staffStatus(a.id, 'confirmed', { scope: 'group' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (const [row, from] of [[await h.bookingRow(a.id), a], [await h.bookingRow(b.id), b]]) {
      assert.equal(row.status, 'confirmed');
      assert.equal(hhmm(row.start_time), hhmm(from.start_time));
      assert.equal(row.employee_id, from.employee_id);
      assert.ok(row.bed_id, 'có giường');
    }
    await assertNoOverlaps();
  });

  test('khôi phục cả nhóm mà NV của B đã có lịch khác → BOOKING_CONFLICT cho B, không khôi phục ai; allow_conflict → khôi phục cả hai', T, async () => {
    const { a, b } = await groupOfTwo('cancelled');
    await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[2].id, start: '15:00', end: '16:00', name: 'B busy' });

    const warn = await h.staffStatus(a.id, 'confirmed', { scope: 'group' });
    assert.equal(warn.status, 409, JSON.stringify(warn.data));
    assert.equal(warn.data?.code, 'BOOKING_CONFLICT');
    const busy = (warn.data.conflicts || []).filter(c => c.type === 'employee_busy');
    assert.ok(busy.length && busy.every(c => c.ref === b.id), JSON.stringify(warn.data.conflicts));
    assert.equal((await h.bookingRow(a.id)).status, 'cancelled', 'không lưu nửa vời');
    assert.equal((await h.bookingRow(b.id)).status, 'cancelled');

    const confirmed = await h.staffStatus(a.id, 'confirmed', { scope: 'group', allowConflict: true });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal((await h.bookingRow(a.id)).status, 'confirmed');
    assert.equal((await h.bookingRow(b.id)).status, 'confirmed');
  });

  test('khôi phục Chỉ khách này → chỉ A confirmed, B vẫn cancelled', T, async () => {
    const { a, b } = await groupOfTwo('cancelled');
    const r = await h.staffStatus(a.id, 'confirmed', { scope: 'booking' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await h.bookingRow(a.id)).status, 'confirmed');
    assert.equal((await h.bookingRow(b.id)).status, 'cancelled');
  });

  test('lịch lẻ đã hủy đổi thẳng sang completed (bấm nhầm hủy) → completed, có giường', T, async () => {
    const solo = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Solo', status: 'cancelled' });
    const r = await h.staffStatus(solo.id, 'completed');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const row = await h.bookingRow(solo.id);
    assert.equal(row.status, 'completed');
    assert.ok(row.bed_id);
  });

  test('AI hủy cả nhóm từ khách đã đến → khách đó giữ nguyên (báo bỏ qua), khách khác cancelled', T, async () => {
    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Group A', groupId, status: 'arrived' });
    const b = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, start: '14:30', end: '16:00', name: 'Group B', groupId });
    const r = await h.aiTool('delete_booking', { booking_id: a.id });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.deepEqual(r.cancelled, [b.id]);
    assert.deepEqual(r.skipped, [a.id]);
    assert.equal((await h.bookingRow(a.id)).status, 'arrived');
    assert.equal((await h.bookingRow(b.id)).status, 'cancelled');
  });
});

// #15 — AI update_booking qua Booking change (ROADMAP › "Group rules", ADR 0001)
describe('AI sửa lịch qua Booking change', () => {
  // A 14:00–15:00 (NV 0), B 14:30–16:00 (NV 1), cùng nhóm
  async function groupOfTwo({ date, nameA = 'AI Group A', nameB = 'AI Group B', notes } = {}) {
    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, date, start: '14:00', end: '15:00', name: nameA, groupId, notes });
    const b = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, date, start: '14:30', end: '16:00', name: nameB, groupId, notes });
    return { a, b };
  }
  const hhmm = (t) => String(t).slice(0, 5);

  test('dời nhóm (không nói scope) → cả nhóm cùng giờ bắt đầu mới, mỗi người giữ thời lượng + NV của mình', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.aiTool('update_booking', { booking_id: a.id, start_time: '16:00' });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    const [rowA, rowB] = [await h.bookingRow(a.id), await h.bookingRow(b.id)];
    assert.equal(hhmm(rowA.start_time), '16:00');
    assert.equal(hhmm(rowA.end_time), '17:00');
    assert.equal(hhmm(rowB.start_time), '16:00');
    assert.equal(hhmm(rowB.end_time), '17:30');
    assert.equal(rowB.employee_id, h.employee(1).id, 'B giữ NV của mình');
    await assertNoOverlaps();
  });

  test('scope booking → chỉ khách đó dời, khách kia giữ nguyên và vẫn trong nhóm', T, async () => {
    const { a, b } = await groupOfTwo();
    const r = await h.aiTool('update_booking', { booking_id: a.id, start_time: '16:00', scope: 'booking' });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal(hhmm((await h.bookingRow(a.id)).start_time), '16:00');
    const rowB = await h.bookingRow(b.id);
    assert.equal(hhmm(rowB.start_time), '14:30');
    assert.equal(hhmm(rowB.end_time), '16:00');
    assert.equal(rowB.group_booking_id, a.group_booking_id, 'B vẫn trong nhóm');
  });

  test('dời sang ngày khác bằng booking_date → cả nhóm sang ngày mới, giữ giờ bắt đầu của mình', T, async () => {
    const { a, b } = await groupOfTwo({ date: h.TODAY });
    const r = await h.aiTool('update_booking', { booking_id: a.id, booking_date: h.TEST_DATE });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    const [rowA, rowB] = [await h.bookingRow(a.id), await h.bookingRow(b.id)];
    assert.equal(rowA.booking_date, h.TEST_DATE);
    assert.equal(rowB.booking_date, h.TEST_DATE);
    assert.equal(hhmm(rowA.start_time), '14:00');
    assert.equal(hhmm(rowB.start_time), '14:30');
    await assertNoOverlaps();
  });

  test('tham số không khai báo (bed_id, total_price) không được ghi', T, async () => {
    const { a } = await groupOfTwo();
    const r = await h.aiTool('update_booking', { booking_id: a.id, scope: 'booking', notes: 'Ghi chú', bed_id: h.ctx.beds[3].id, total_price: 999 });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    const row = await h.bookingRow(a.id);
    assert.equal(row.bed_id, h.ctx.beds[0].id, 'giường giữ nguyên');
    assert.notEqual(row.total_price, 999, 'giá không lấy từ model');
  });

  test('dời nhóm mà NV của B bận → chặn, 1 token cho cả nhóm, chưa lưu gì; gửi lại (kèm scope group) + token → lưu cả hai', T, async () => {
    const { a, b } = await groupOfTwo();
    await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[2].id, start: '16:30', end: '17:30', name: 'AI B busy' });

    const blocked = await h.aiTool('update_booking', { booking_id: a.id, start_time: '16:00' });
    assert.equal(aiOk(blocked), false, JSON.stringify(blocked));
    assert.equal(typeof blocked.confirm_token, 'string', JSON.stringify(blocked));
    const busy = (blocked.conflicts || []).filter(c => c.type === 'employee_busy');
    assert.ok(busy.length && busy.every(c => c.ref === b.id), JSON.stringify(blocked.conflicts));
    assert.equal(hhmm((await h.bookingRow(a.id)).start_time), '14:00', 'không lưu nửa vời: A giữ nguyên');
    assert.equal(hhmm((await h.bookingRow(b.id)).start_time), '14:30');

    const confirmed = await h.aiTool('update_booking', { booking_id: a.id, start_time: '16:00', scope: 'group', confirm_token: blocked.confirm_token });
    assert.equal(aiOk(confirmed), true, JSON.stringify(confirmed));
    assert.equal(hhmm((await h.bookingRow(a.id)).start_time), '16:00');
    const rowB = await h.bookingRow(b.id);
    assert.equal(hhmm(rowB.start_time), '16:00');
    assert.equal(rowB.employee_id, h.employee(1).id, 'xác nhận thì giữ đúng NV của B');
  });

  test('ghi chú thay bằng đúng nội dung gửi (không nối), kết quả có trước → sau', T, async () => {
    const { a, b } = await groupOfTwo({ notes: 'Dị ứng tinh dầu' });
    const after = 'Dị ứng tinh dầu, thích phòng tối';
    const r = await h.aiTool('update_booking', { booking_id: a.id, notes: after });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.deepEqual(r.notes, { before: 'Dị ứng tinh dầu', after });
    assert.equal((await h.bookingRow(a.id)).notes, after);
    assert.equal((await h.bookingRow(b.id)).notes, after, 'cả nhóm cùng ghi chú mới');
  });

  test('chỉ 1 khách mà cả nhóm cùng tên → chưa lưu, trả danh sách khách (NV / giờ / dịch vụ); guest_confirmed → chỉ khách đó', T, async () => {
    const { a, b } = await groupOfTwo({ nameA: 'AI Mia', nameB: 'AI Mia' });
    const ask = await h.aiTool('update_booking', { booking_id: a.id, start_time: '16:00', scope: 'booking' });
    assert.equal(aiOk(ask), false, JSON.stringify(ask));
    assert.equal(ask.needs_guest_choice, true, JSON.stringify(ask));
    assert.deepEqual(ask.guests.map(g => [g.booking_id, g.therapist, g.start_time]).sort(),
      [[a.id, h.employee(0).name, '14:00'], [b.id, h.employee(1).name, '14:30']].sort());
    assert.ok(ask.guests.every(g => g.service), 'mỗi khách có tên dịch vụ');
    assert.equal(hhmm((await h.bookingRow(a.id)).start_time), '14:00', 'chưa lưu gì');

    const r = await h.aiTool('update_booking', { booking_id: a.id, start_time: '16:00', scope: 'booking', guest_confirmed: true });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal(hhmm((await h.bookingRow(a.id)).start_time), '16:00');
    assert.equal(hhmm((await h.bookingRow(b.id)).start_time), '14:30');
  });

  test('AI hủy 1 khách mà cả nhóm cùng tên → chưa hủy, trả danh sách khách; guest_confirmed → chỉ khách đó', T, async () => {
    const { a, b } = await groupOfTwo({ nameA: 'AI Mia', nameB: 'AI Mia' });
    const ask = await h.aiTool('delete_booking', { booking_id: a.id, scope: 'booking' });
    assert.equal(ask.needs_guest_choice, true, JSON.stringify(ask));
    assert.equal(ask.guests.length, 2);
    assert.equal((await h.bookingRow(a.id)).status, 'confirmed', 'chưa hủy ai');

    const r = await h.aiTool('delete_booking', { booking_id: a.id, scope: 'booking', guest_confirmed: true });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal((await h.bookingRow(a.id)).status, 'cancelled');
    assert.equal((await h.bookingRow(b.id)).status, 'confirmed');
  });
});

// #15 (việc còn lại của #14): AI check-in — token theo scope đã chuẩn hóa, hỏi khách nào khi nhóm cùng tên
describe('AI check-in nhóm: token + hỏi khách nào', () => {
  const nowMin = h.vnNowMinutes();
  const S = { ...T, skip: nowMin < 10 * 60 + 30 || nowMin > 20 * 60 ? 'chỉ chạy được trong khoảng 10:30–20:00 giờ VN' : false };
  async function arrivingGroup({ startOffset = -10, name = 'AI Arrive' } = {}) {
    const groupId = crypto.randomUUID();
    const start = Math.floor((nowMin + startOffset) / 5) * 5;
    const at = { date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), groupId };
    const a = await h.insertFixture({ ...at, employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, name });
    const b = await h.insertFixture({ ...at, employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, name });
    return { a, b };
  }

  test('nhóm check-in trễ chồng lịch kế tiếp, không gửi scope → chặn + token; gửi lại kèm scope group + token → cả nhóm arrived', S, async () => {
    const { a, b } = await arrivingGroup({ startOffset: -60 });
    await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[2].id, date: h.TODAY, start: h.toHHMM(nowMin + 15), end: h.toHHMM(nowMin + 75), name: 'AI next' });

    const blocked = await h.aiTool('check_in_booking', { booking_id: a.id });
    assert.equal(aiOk(blocked), false, JSON.stringify(blocked));
    assert.equal(typeof blocked.confirm_token, 'string', JSON.stringify(blocked));

    const confirmed = await h.aiTool('check_in_booking', { booking_id: a.id, scope: 'group', confirm_token: blocked.confirm_token });
    assert.equal(aiOk(confirmed), true, JSON.stringify(confirmed));
    assert.equal((await h.bookingRow(a.id)).status, 'arrived');
    assert.equal((await h.bookingRow(b.id)).status, 'arrived');
  });

  test('check-in 1 khách mà cả nhóm cùng tên → chưa check-in, trả danh sách khách; guest_confirmed → chỉ khách đó', S, async () => {
    const { a, b } = await arrivingGroup();
    const ask = await h.aiTool('check_in_booking', { booking_id: a.id, scope: 'booking' });
    assert.equal(ask.needs_guest_choice, true, JSON.stringify(ask));
    assert.equal(ask.guests.length, 2);
    assert.equal((await h.bookingRow(a.id)).status, 'confirmed', 'chưa check-in ai');

    const r = await h.aiTool('check_in_booking', { booking_id: a.id, scope: 'booking', guest_confirmed: true });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal((await h.bookingRow(a.id)).status, 'arrived');
    assert.equal((await h.bookingRow(b.id)).status, 'confirmed');
  });

  test('token check-in chỉ gắn với thay đổi: gửi lại không kèm guest_confirmed vẫn khớp', S, async () => {
    const start = Math.floor((nowMin - 60) / 5) * 5;
    const late = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, date: h.TODAY, start: h.toHHMM(start), end: h.toHHMM(start + 60), name: 'AI late solo' });
    await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[2].id, date: h.TODAY, start: h.toHHMM(nowMin + 15), end: h.toHHMM(nowMin + 75), name: 'AI next' });

    const blocked = await h.aiTool('check_in_booking', { booking_id: late.id, scope: 'booking', guest_confirmed: true });
    assert.equal(typeof blocked.confirm_token, 'string', JSON.stringify(blocked));
    const confirmed = await h.aiTool('check_in_booking', { booking_id: late.id, scope: 'booking', confirm_token: blocked.confirm_token });
    assert.equal(aiOk(confirmed), true, JSON.stringify(confirmed));
    assert.equal((await h.bookingRow(late.id)).status, 'arrived');
  });
});

// #16 — Hoàn tác thao tác AI qua Booking change (ROADMAP › "Booking rules": Undo; "Group rules": Undo)
describe('Hoàn tác thao tác AI', () => {
  // A 14:00–15:00 (NV 0, giường 0), B 14:30–16:00 (NV 1, giường 1), cùng nhóm
  async function groupOfTwo() {
    const groupId = crypto.randomUUID();
    const a = await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Undo A', groupId });
    const b = await h.insertFixture({ employeeId: h.employee(1).id, bedId: h.ctx.beds[1].id, start: '14:30', end: '16:00', name: 'Undo B', groupId });
    return { a, b };
  }
  const hhmm = (t) => String(t).slice(0, 5);
  async function aiMoveGroup(a) {
    const { result, action } = await h.aiAction('update_booking', { booking_id: a.id, start_time: '16:00' });
    assert.equal(aiOk(result), true, JSON.stringify(result));
    assert.ok(action?.sig, 'có action hoàn tác đã ký');
    return action;
  }

  test('AI dời nhóm rồi Hoàn tác → mọi khách về đúng giờ, NV, giường cũ', T, async () => {
    const { a, b } = await groupOfTwo();
    const action = await aiMoveGroup(a);
    const r = await h.undo([action]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([...r.data.restored].sort(), [a.id, b.id].sort());
    for (const from of [a, b]) {
      const row = await h.bookingRow(from.id);
      assert.equal(hhmm(row.start_time), hhmm(from.start_time));
      assert.equal(hhmm(row.end_time), hhmm(from.end_time));
      assert.equal(row.employee_id, from.employee_id);
      assert.equal(row.bed_id, from.bed_id);
    }
  });

  test('AI hủy cả nhóm rồi Hoàn tác → mọi khách về trạng thái cũ', T, async () => {
    const { a, b } = await groupOfTwo();
    const { result, action } = await h.aiAction('delete_booking', { booking_id: a.id });
    assert.equal(aiOk(result), true, JSON.stringify(result));
    const r = await h.undo([action]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await h.bookingRow(a.id)).status, 'confirmed');
    assert.equal((await h.bookingRow(b.id)).status, 'confirmed');
    await assertNoOverlaps();
  });

  test('Hoàn tác bỏ qua lịch đã bị sửa sau thao tác của AI, vẫn khôi phục các lịch khác', T, async () => {
    const { a, b } = await groupOfTwo();
    const action = await aiMoveGroup(a);
    const edited = await h.staffUpdate(await h.bookingRow(b.id), { notes: 'Sửa sau AI', scope: 'booking' });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));

    const r = await h.undo([action]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.skipped, [b.id]);
    assert.equal(hhmm((await h.bookingRow(a.id)).start_time), '14:00');
    const rowB = await h.bookingRow(b.id);
    assert.equal(hhmm(rowB.start_time), '16:00', 'B giữ nguyên thay đổi mới');
    assert.equal(rowB.notes, 'Sửa sau AI');
  });

  test('NV cũ đã có lịch khác ở giờ cũ → Hoàn tác vẫn khôi phục đúng NV, không hỏi "Vẫn lưu?"', T, async () => {
    const { a } = await groupOfTwo();
    const action = await aiMoveGroup(a);
    await h.insertFixture({ employeeId: h.employee(0).id, bedId: h.ctx.beds[2].id, start: '14:00', end: '15:00', name: 'Undo taken' });

    const r = await h.undo([action]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const row = await h.bookingRow(a.id);
    assert.equal(hhmm(row.start_time), '14:00');
    assert.equal(row.employee_id, h.employee(0).id);
  });

  test('giường cũ đã có người dùng ở giờ cũ → Hoàn tác về đúng giờ + NV, lấy giường trống khác (không chồng giường)', T, async () => {
    const { a } = await groupOfTwo();
    const action = await aiMoveGroup(a);
    await h.insertFixture({ employeeId: h.employee(2).id, bedId: h.ctx.beds[0].id, start: '14:00', end: '15:00', name: 'Undo bed taken' });

    const r = await h.undo([action]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const row = await h.bookingRow(a.id);
    assert.equal(hhmm(row.start_time), '14:00');
    assert.equal(row.employee_id, h.employee(0).id);
    assert.ok(row.bed_id, 'có giường');
    assert.notEqual(row.bed_id, h.ctx.beds[0].id, 'không chồng lên giường đang dùng');
    await assertNoOverlaps();
  });
});

// #16 — AI dồn lịch của 1 NV qua Booking change (ROADMAP › "Booking rules": AI reassign)
describe('AI dồn lịch của nhân viên nghỉ', () => {
  test('dồn sang NV rảnh; lịch không ai nhận được thì giữ nguyên và được báo lại', T, async () => {
    const from = h.employee(0);
    const x = await h.insertFixture({ employeeId: from.id, bedId: h.ctx.beds[0].id, start: '10:00', end: '11:00', name: 'Reassign X' });
    const y = await h.insertFixture({ employeeId: from.id, bedId: h.ctx.beds[0].id, start: '16:00', end: '17:00', name: 'Reassign Y' });
    for (const emp of h.ctx.employees.slice(1)) {
      await h.insertFixture({ employeeId: emp.id, start: '16:00', end: '17:00', name: `Reassign busy ${emp.name}` });
    }

    const r = await h.aiTool('reassign_staff_bookings', { from_employee_id: from.id, date: h.TEST_DATE });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.deepEqual(r.unassigned_booking_ids, [y.id]);
    const rowX = await h.bookingRow(x.id);
    assert.ok(rowX.employee_id && rowX.employee_id !== from.id, 'X sang NV khác');
    assert.equal(String(rowX.start_time).slice(0, 5), '10:00', 'giữ giờ bắt đầu');
    assert.equal((await h.bookingRow(y.id)).employee_id, from.id, 'Y giữ nguyên');
    await assertNoOverlaps();
  });

  test('khách đã đến / đã xong giữ NV của mình; chỉ dồn lịch chưa bắt đầu', T, async () => {
    const from = h.employee(0);
    const done = await h.insertFixture({ employeeId: from.id, bedId: h.ctx.beds[0].id, start: '09:00', end: '10:00', name: 'Reassign done', status: 'completed' });
    const now = await h.insertFixture({ employeeId: from.id, bedId: h.ctx.beds[0].id, start: '12:00', end: '13:00', name: 'Reassign now', status: 'arrived' });
    const next = await h.insertFixture({ employeeId: from.id, bedId: h.ctx.beds[0].id, start: '15:00', end: '16:00', name: 'Reassign next' });

    const r = await h.aiTool('reassign_staff_bookings', { from_employee_id: from.id, date: h.TEST_DATE });
    assert.equal(aiOk(r), true, JSON.stringify(r));
    assert.equal((await h.bookingRow(done.id)).employee_id, from.id);
    assert.equal((await h.bookingRow(now.id)).employee_id, from.id);
    const rowNext = await h.bookingRow(next.id);
    assert.ok(rowNext.employee_id && rowNext.employee_id !== from.id, 'lịch chưa bắt đầu sang NV khác');
  });
});
