process.env.UNDO_SIGNING_SECRET = process.env.UNDO_SIGNING_SECRET || 'test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRM_TTL_MS, issueConfirmToken, consumeConfirmToken, rememberPending, peekPending } = require('./confirmToken');

const base = {
  uid: 'user-1',
  tool: 'create_booking',
  params: { start_time: '15:00', employee_ids: ['e1'], customer_name_hint: 'Lan' },
  conflicts: [{ type: 'employee_busy', ref: 0, id: 'b1' }]
};

test('token đúng → dùng được đúng 1 lần', () => {
  const token = issueConfirmToken(base);
  assert.deepEqual(consumeConfirmToken(token, base), { ok: true });
  assert.equal(consumeConfirmToken(token, base).reason, 'used');
});

test('đổi tham số → token không còn hiệu lực', () => {
  const token = issueConfirmToken(base);
  const r = consumeConfirmToken(token, { ...base, params: { ...base.params, start_time: '15:30' } });
  assert.equal(r.reason, 'changed');
});

test('customer_name_hint / confirm_token không ảnh hưởng', () => {
  const token = issueConfirmToken(base);
  const r = consumeConfirmToken(token, { ...base, params: { ...base.params, customer_name_hint: 'Chị Lan', confirm_token: token } });
  assert.deepEqual(r, { ok: true });
});

test('vướng mắc khác lúc hỏi → phải hỏi lại', () => {
  const token = issueConfirmToken(base);
  const r = consumeConfirmToken(token, { ...base, conflicts: [...base.conflicts, { type: 'no_bed', ref: 0 }] });
  assert.equal(r.reason, 'changed');
});

test('thứ tự vướng mắc không quan trọng', () => {
  const conflicts = [{ type: 'no_bed', ref: 0 }, { type: 'employee_busy', ref: 0, id: 'b1' }];
  const token = issueConfirmToken({ ...base, conflicts });
  assert.deepEqual(consumeConfirmToken(token, { ...base, conflicts: [...conflicts].reverse() }), { ok: true });
});

test('quá 5 phút → hết hạn', () => {
  const now = Date.now();
  const token = issueConfirmToken({ ...base, now });
  assert.equal(consumeConfirmToken(token, { ...base, now: now + CONFIRM_TTL_MS + 1 }).reason, 'expired');
});

test('người khác dùng token → từ chối', () => {
  const token = issueConfirmToken(base);
  assert.equal(consumeConfirmToken(token, { ...base, uid: 'user-2' }).reason, 'other_user');
});

test('token giả / bị sửa → từ chối', () => {
  assert.equal(consumeConfirmToken('fake-token', base).reason, 'invalid');
  const token = issueConfirmToken(base);
  const [body, sig] = token.split('.');
  assert.equal(consumeConfirmToken(`${body}x.${sig}`, base).reason, 'invalid');
});

test('lời xác nhận đang chờ: nhớ, hết hạn, xóa khi đã dùng', () => {
  const now = Date.now();
  const token = issueConfirmToken({ ...base, now });
  rememberPending('user-1', { tool: 'create_booking', args: base.params, token, now });
  assert.equal(peekPending('user-1', now).token, token);
  assert.equal(peekPending('user-1', now).args.customer_name_hint, undefined);
  assert.equal(peekPending('user-1', now + CONFIRM_TTL_MS + 1), null);

  rememberPending('user-1', { tool: 'create_booking', args: base.params, token, now });
  consumeConfirmToken(token, { ...base, now });
  assert.equal(peekPending('user-1', now), null);
});
