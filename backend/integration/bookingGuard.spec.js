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
