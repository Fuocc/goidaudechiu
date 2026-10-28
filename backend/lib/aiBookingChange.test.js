const test = require('node:test');
const assert = require('node:assert/strict');
const { toBookingChange, guestChoice, matchContact } = require('./aiBookingChange');

// Lịch đang lưu trong DB (giờ dạng HH:MM:SS như Postgres trả về)
const booking = (o = {}) => ({
  id: 'bk1', service_id: 's1', branch_id: 'br1', employee_id: 'e1', bed_id: 'bed1',
  booking_date: '2026-11-09', start_time: '15:00:00', end_time: '16:00:00',
  notes: 'Ghi chú cũ', status: 'confirmed', ...o
});

test('chỉ lấy field được phép từ tham số của model; field khác (giường, giá, giờ kết thúc, trạng thái…) bị bỏ', () => {
  const { change } = toBookingChange({
    booking_id: 'bk1', booking_date: '2026-11-10', start_time: '16:00', service_id: 's2', branch_id: 'br2',
    employee_id: 'e2', notes: 'Ghi chú mới',
    bed_id: 'bed9', total_price: 1, end_time: '23:00', status: 'cancelled', num_guests: 5,
    customer_id: 'c9', internal_note: 'x', temporary_name: 'y', confirm_token: 't', customer_name_hint: 'Mia'
  }, booking());
  assert.deepEqual(Object.keys(change).sort(), ['booking_date', 'branch_id', 'employee_id', 'notes', 'service_id', 'start_time']);
  assert.equal(change.booking_date, '2026-11-10');
  assert.equal(change.start_time, '16:00');
  assert.equal(change.service_id, 's2');
  assert.equal(change.branch_id, 'br2');
  assert.equal(change.employee_id, 'e2');
  assert.equal(change.notes, 'Ghi chú mới');
});

test('scope: không gửi hoặc giá trị lạ → group (cả nhóm); booking giữ nguyên', () => {
  assert.equal(toBookingChange({ booking_id: 'bk1' }, booking()).scope, 'group');
  assert.equal(toBookingChange({ booking_id: 'bk1', scope: 'all' }, booking()).scope, 'group');
  assert.equal(toBookingChange({ booking_id: 'bk1', scope: 'group' }, booking()).scope, 'group');
  assert.equal(toBookingChange({ booking_id: 'bk1', scope: 'booking' }, booking()).scope, 'booking');
});

test('không đổi dịch vụ → gửi end_time giữ đúng thời lượng đang đặt (lịch NV đã kéo dài không bị rút ngắn)', () => {
  // Lịch 60 phút đã được kéo dài thành 15:00–16:30
  const stretched = booking({ end_time: '16:30:00' });
  assert.equal(toBookingChange({ start_time: '17:00' }, stretched).change.end_time, '18:30', 'dời giờ');
  assert.equal(toBookingChange({ notes: 'Mới' }, stretched).change.end_time, '16:30', 'chỉ sửa ghi chú');
  assert.equal(toBookingChange({ booking_date: '2026-11-10' }, stretched).change.end_time, '16:30', 'chỉ đổi ngày');
});

test('đổi dịch vụ → không gửi end_time (module tính theo thời lượng dịch vụ mới)', () => {
  assert.equal(toBookingChange({ service_id: 's2', start_time: '17:00' }, booking({ end_time: '16:30:00' })).change.end_time, undefined);
});

// Khách trong nhóm, kèm tên NV / dịch vụ như khi đọc từ DB
const guest = (id, o = {}) => ({
  id, temporary_name: 'Miss Mia', status: 'confirmed', start_time: '15:00:00', end_time: '16:00:00',
  employees: { name: `NV ${id}` }, services: { name: 'Ý dễ chịu' }, ...o
});

test('chỉ 1 khách mà tên trùng khách khác trong nhóm (chưa xác nhận) → trả danh sách khách: NV / giờ / dịch vụ', () => {
  const a = guest('a');
  const b = guest('b', { temporary_name: 'miss  mia ', start_time: '15:30:00', services: { name: 'Combo 17' } });
  const guests = guestChoice({ booking: a, group: [b], scope: 'booking' });
  assert.deepEqual(guests, [
    { booking_id: 'a', name: 'Miss Mia', therapist: 'NV a', start_time: '15:00', service: 'Ý dễ chịu' },
    { booking_id: 'b', name: 'miss  mia ', therapist: 'NV b', start_time: '15:30', service: 'Combo 17' }
  ]);
});

test('không cần hỏi khách nào: cả nhóm, đã xác nhận, lịch lẻ, tên riêng, hoặc khách trùng tên đã hủy', () => {
  const a = guest('a');
  assert.equal(guestChoice({ booking: a, group: [guest('b')], scope: 'group' }), null, 'cả nhóm');
  assert.equal(guestChoice({ booking: a, group: [guest('b')], scope: 'booking', guestConfirmed: true }), null, 'đã xác nhận');
  assert.equal(guestChoice({ booking: a, group: [], scope: 'booking' }), null, 'lịch lẻ');
  assert.equal(guestChoice({ booking: guest('a', { temporary_name: 'Lan' }), group: [guest('b')], scope: 'booking' }), null, 'tên riêng');
  assert.equal(guestChoice({ booking: a, group: [guest('b', { status: 'cancelled' })], scope: 'booking' }), null, 'khách kia đã hủy');
});

test('tên lấy từ khách đặt khi lịch không có tên riêng; NV trống → "Chưa xếp NV"', () => {
  const a = guest('a', { temporary_name: null, customers: { name: 'Mia' } });
  const b = guest('b', { temporary_name: null, customers: { name: 'Mia' }, employees: null });
  const guests = guestChoice({ booking: a, group: [b], scope: 'booking' });
  assert.equal(guests[1].name, 'Mia');
  assert.equal(guests[1].therapist, 'Chưa xếp NV');
});

// Lời người dùng không hề nói giờ → model tự đặt giờ (VD đọc "4050" thành 18:50) → bỏ start_time, lịch giữ giờ cũ
test('lời người dùng không nói giờ → bỏ start_time model gửi (VD SĐT "4050" bị đọc thành 18:50)', () => {
  const { change } = toBookingChange({ start_time: '18:50', service_id: 's2' }, booking(), { userTexts: ['Chị Linh - 4050 - 2yvv'] });
  assert.equal(change.start_time, undefined);
  assert.equal(change.service_id, 's2');
});

test('lời người dùng có nói giờ (giờ cụ thể, giờ tương đối, "bây giờ") → giữ start_time', () => {
  for (const said of ['dời 18h50', 'đổi sang 6g', 'lùi 30p', 'bây giờ', 'chiều nay 5h', '18:50 nhé', 'dời sang 7h30 tối']) {
    const { change } = toBookingChange({ start_time: '18:50' }, booking(), { userTexts: [said] });
    assert.equal(change.start_time, '18:50', said);
  }
});

test('giờ nói ở lượt trước (VD AI hỏi khách nào rồi người dùng chọn) → giữ start_time', () => {
  const { change } = toBookingChange({ start_time: '18:50', guest_confirmed: true }, booking(), { userTexts: ['khách 1', 'dời Mia sang 18h50'] });
  assert.equal(change.start_time, '18:50');
});

// 28/10: "Vẫn lưu" gửi lại cũng lọc như mọi lệnh (token cấp trên tham số đã lọc → gửi lại phải lọc giống vậy mới khớp)
test('gửi lại kèm confirm_token: lượt trước có nói giờ → giữ start_time; không lượt nào nói giờ → bỏ', () => {
  const kept = toBookingChange({ start_time: '16:00', confirm_token: 't' }, booking(), { userTexts: ['vẫn lưu', 'dời sang 16h'] });
  assert.equal(kept.change.start_time, '16:00');
  const dropped = toBookingChange({ start_time: '18:50', confirm_token: 't' }, booking(), { userTexts: ['vẫn lưu', 'Chị Linh - 4050 - 2yvv'] });
  assert.equal(dropped.change.start_time, undefined);
});

test('bỏ start_time → báo lại giờ model gửi để AI nói lý do; không bỏ → không báo', () => {
  assert.equal(toBookingChange({ start_time: '18:50' }, booking(), { userTexts: ['Chị Linh - 4050'] }).ignoredStartTime, '18:50');
  assert.equal(toBookingChange({ start_time: '18:50' }, booking(), { userTexts: ['dời 18h50'] }).ignoredStartTime, undefined);
  assert.equal(toBookingChange({ service_id: 's2' }, booking(), { userTexts: ['đổi yvv'] }).ignoredStartTime, undefined);
});

// Hồ sơ khách tìm được theo tên (như khi đọc từ DB)
const customers = [
  { id: 'c1', name: 'Chị Linh', phone: '0901234050' },
  { id: 'c2', name: 'Chị Linh', phone: '0987771111' },
  { id: 'c3', name: 'Linh Đan', phone: '0912344050' },
  { id: 'c4', name: 'Mai', phone: '0905554050' }
];

test('Contact: tên + số trong SĐT khớp đúng 1 hồ sơ → gắn hồ sơ đó', () => {
  assert.deepEqual(matchContact({ name: 'Chị Linh', phoneHint: '4050', customers }), { customerId: 'c1' });
});

test('Contact: tên + số khớp từ 2 hồ sơ → hỏi lại, kèm tên + SĐT từng hồ sơ', () => {
  const twins = [...customers, { id: 'c5', name: 'chị  linh', phone: '0938884050' }];
  assert.deepEqual(matchContact({ name: 'Chị Linh', phoneHint: '4050', customers: twins }), {
    candidates: [
      { customer_id: 'c1', name: 'Chị Linh', phone: '0901234050' },
      { customer_id: 'c5', name: 'chị  linh', phone: '0938884050' }
    ]
  });
});

test('Contact: tên + số không khớp hồ sơ nào → tên riêng (temporary name)', () => {
  assert.deepEqual(matchContact({ name: 'Chị Linh', phoneHint: '9999', customers }), { temporaryName: 'Chị Linh' });
});

test('Contact: chỉ có tên, đúng 1 hồ sơ cùng tên → gắn hồ sơ đó', () => {
  assert.deepEqual(matchContact({ name: 'Anh Mai', customers }), { customerId: 'c4' });
});

test('Contact: chỉ có tên, từ 2 hồ sơ cùng tên (hoặc không có) → tên riêng', () => {
  assert.deepEqual(matchContact({ name: 'Chị Linh', customers }), { temporaryName: 'Chị Linh' }, '2 hồ sơ "Linh"');
  assert.deepEqual(matchContact({ name: 'Chị Hoa', customers }), { temporaryName: 'Chị Hoa' }, 'không có');
});

test('Contact đã khớp hồ sơ → gắn customer_id, bỏ tên riêng; ghi chú không đổi', () => {
  const { change } = toBookingChange({ customer_name: 'Chị Linh', phone_hint: '4050' }, booking({ temporary_name: 'Khách Lạ' }), { contact: { customerId: 'c1' } });
  assert.equal(change.customer_id, 'c1');
  assert.equal(change.temporary_name, null);
  assert.equal(change.notes, undefined);
});

test('Contact không khớp hồ sơ → tên riêng, bỏ gắn hồ sơ; ghi chú không đổi', () => {
  const { change } = toBookingChange({ customer_name: 'Chị Linh' }, booking({ customer_id: 'c9' }), { contact: { temporaryName: 'Chị Linh' } });
  assert.equal(change.customer_id, null);
  assert.equal(change.temporary_name, 'Chị Linh');
  assert.equal(change.notes, undefined);
});

test('số SĐT / tên dịch vụ / tên người không bị coi là giờ → vẫn bỏ start_time', () => {
  for (const said of ['Linh 4050 gội đầu', 'Linh 4050 hot stone', 'chị Linh 4050: đổi yvv', 'Chị Trâm 2 phòng', 'Linh 4050 snow']) {
    const { change } = toBookingChange({ start_time: '18:50' }, booking(), { userTexts: [said] });
    assert.equal(change.start_time, undefined, said);
  }
});

test('giờ tương đối không có số ("thêm nửa tiếng") → giữ start_time', () => {
  const { change } = toBookingChange({ start_time: '18:50' }, booking(), { userTexts: ['thêm nửa tiếng'] });
  assert.equal(change.start_time, '18:50');
});

test('tool gọi ngoài chat (không có lời người dùng) → giữ start_time', () => {
  assert.equal(toBookingChange({ start_time: '18:50' }, booking()).change.start_time, '18:50');
});

test('Contact: tiền tố chỉ bỏ khi là chữ riêng ("Anhthư" không thành "thư"; "Cô Linh" khớp "Linh")', () => {
  assert.deepEqual(matchContact({ name: 'Anhthư', customers: [{ id: 'x', name: 'Thư', phone: '1' }] }), { temporaryName: 'Anhthư' });
  assert.deepEqual(matchContact({ name: 'Cô Mai', customers }), { customerId: 'c4' });
});

// Danh xưng: cùng danh xưng → cùng tên; khác danh xưng → khác người; 1 bên không có → chỉ khớp khi chỉ có đúng 1 người tên đó
const mais = [{ id: 'm1', name: 'Cô Mai', phone: '0901110001' }, { id: 'm2', name: 'Chị Mai', phone: '0902220002' }];

test('Contact: cùng danh xưng → khớp; khác danh xưng (Cô Mai ≠ Chị Mai) → khác người', () => {
  assert.deepEqual(matchContact({ name: 'Cô Mai', customers: mais }), { customerId: 'm1' });
  assert.deepEqual(matchContact({ name: 'Chị Mai', customers: mais }), { customerId: 'm2' });
  assert.deepEqual(matchContact({ name: 'Anh Mai', customers: mais }), { temporaryName: 'Anh Mai' });
  assert.deepEqual(matchContact({ name: 'Cô Mai', phoneHint: '2220', customers: mais }), { temporaryName: 'Cô Mai' }, 'số khớp Chị Mai nhưng khác danh xưng');
});

test('Contact: 1 bên không có danh xưng → chỉ khớp khi chỉ có đúng 1 người tên đó', () => {
  assert.deepEqual(matchContact({ name: 'Mai', customers: mais }), { temporaryName: 'Mai' }, '2 Mai → không đoán');
  assert.deepEqual(matchContact({ name: 'Mai', customers: [mais[0]] }), { customerId: 'm1' }, 'chỉ 1 Mai');
  const plain = [{ id: 'p1', name: 'Mai', phone: '0903330003' }];
  assert.deepEqual(matchContact({ name: 'Cô Mai', customers: plain }), { customerId: 'p1' }, 'chỉ 1 Mai (hồ sơ không danh xưng)');
  assert.deepEqual(matchContact({ name: 'Cô Mai', customers: [...plain, mais[1]] }), { temporaryName: 'Cô Mai' }, '2 Mai → không đoán');
});
