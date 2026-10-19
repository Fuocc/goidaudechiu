/**
 * Token xác nhận một lần cho AI (ROADMAP.md › Booking rules).
 *
 * AI bị chặn vì chồng lịch / ngoài ca / hết giường → server cấp confirm_token gắn với ĐÚNG thay đổi đó
 * (tên tool + tham số + danh sách vướng mắc) và đúng người dùng, hạn 5 phút. AI hỏi "Vẫn lưu?", người dùng
 * đồng ý thì AI gửi lại cùng tham số kèm token. Model không thể tự "xác nhận hộ": không có token hợp lệ
 * thì không lưu. Đổi tham số, dùng lại token, quá hạn, khác người, hay vướng mắc đã khác → từ chối.
 *
 * Token dùng-một-lần được nhớ trong bộ nhớ tiến trình (backend chạy 1 tiến trình). Khởi động lại server
 * chỉ làm token đang chờ không dùng được nữa → AI hỏi lại, không có gì bị lưu sai.
 */
const crypto = require('crypto');
const { signingKey, stableStringify } = require('./undoToken');

const CONFIRM_TTL_MS = 5 * 60 * 1000;
// Tham số không làm đổi nội dung thay đổi → không đưa vào dấu vân tay
const IGNORED_PARAMS = new Set(['confirm_token', 'customer_name_hint']);

const usedNonces = new Map(); // nonce → hạn (để dọn)
const pending = new Map();    // uid → { tool, args, token, exp } — lời xác nhận AI đang chờ người dùng trả lời

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

const key = () => crypto.createHmac('sha256', signingKey()).update('yoi-ai-confirm-v1').digest();
const sign = (body) => crypto.createHmac('sha256', key()).update(body).digest('base64url');

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params || {}).filter(([k, v]) => !IGNORED_PARAMS.has(k) && v !== undefined));
}

// Danh sách vướng mắc (không phụ thuộc thứ tự) — vướng mắc khác lúc hỏi → phải hỏi lại
function conflictSignature(conflicts) {
  return (conflicts || []).map(c => `${c.type}:${c.ref ?? ''}:${c.id || c.employee_id || ''}`).sort();
}

function digest({ tool, params, conflicts }) {
  return crypto.createHash('sha256')
    .update(stableStringify({ tool, params: cleanParams(params), conflicts: conflictSignature(conflicts) }))
    .digest('base64url');
}

function sweep(now) {
  for (const [nonce, exp] of usedNonces) if (exp <= now) usedNonces.delete(nonce);
  for (const [uid, p] of pending) if (p.exp <= now) pending.delete(uid);
}

function issueConfirmToken({ uid, tool, params, conflicts, now = Date.now() }) {
  const body = b64(JSON.stringify({ u: uid || null, d: digest({ tool, params, conflicts }), n: crypto.randomUUID(), e: now + CONFIRM_TTL_MS }));
  return `${body}.${sign(body)}`;
}

/** Kiểm tra VÀ dùng luôn token (một lần). Trả { ok: true } hoặc { ok: false, reason }. */
function consumeConfirmToken(token, { uid, tool, params, conflicts, now = Date.now() }) {
  sweep(now);
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'invalid' };
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: 'invalid' };
  }
  let payload;
  try { payload = JSON.parse(unb64(body)); } catch { return { ok: false, reason: 'invalid' }; }
  if (!(payload.e > now)) return { ok: false, reason: 'expired' };
  if ((payload.u || null) !== (uid || null)) return { ok: false, reason: 'other_user' };
  if (usedNonces.has(payload.n)) return { ok: false, reason: 'used' };
  if (payload.d !== digest({ tool, params, conflicts })) return { ok: false, reason: 'changed' };
  usedNonces.set(payload.n, payload.e);
  if (pending.get(uid)?.token === token) pending.delete(uid);
  return { ok: true };
}

/** Nhớ lời xác nhận đang chờ để lượt chat sau ("ừ", "vẫn lưu") AI gọi lại đúng tool + tham số + token. */
function rememberPending(uid, { tool, args, token, now = Date.now() }) {
  if (!uid) return;
  pending.set(uid, { tool, args: cleanParams(args), token, exp: now + CONFIRM_TTL_MS });
}

function peekPending(uid, now = Date.now()) {
  sweep(now);
  return uid ? pending.get(uid) || null : null;
}

module.exports = { CONFIRM_TTL_MS, issueConfirmToken, consumeConfirmToken, rememberPending, peekPending };
