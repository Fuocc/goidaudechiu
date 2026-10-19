/**
 * Lịch giữ chỗ tạm thời (POST /bookings/hold) — khách đang điền form đặt online.
 * Hạn giữ chỗ cùng quy tắc với SQL booking_guard_hold_expired():
 *   cột hold_expires_at → "EXPIRES:<ms>" trong ghi chú (giữ chỗ cũ) → 10 phút sau khi tạo.
 * Giữ chỗ hết hạn KHÔNG còn chặn slot, kể cả khi chưa được dọn khỏi DB.
 */
const HOLD_NOTE_PREFIX = '[GIỮ CHỖ TẠM THỜI]';
const HOLD_FALLBACK_MS = 10 * 60 * 1000;

const isHoldBooking = (b) =>
  b?.status === 'pending' && typeof b.internal_note === 'string' && b.internal_note.startsWith(HOLD_NOTE_PREFIX);

function holdExpiresAt(b) {
  if (b.hold_expires_at) return Date.parse(b.hold_expires_at);
  const m = /EXPIRES:(\d{1,15})/.exec(b.internal_note || '');
  if (m) return Number(m[1]);
  return Date.parse(b.created_at) + HOLD_FALLBACK_MS;
}

// Thiếu cả created_at (dữ liệu hỏng) → coi như hết hạn, không để nó chặn slot mãi
const isExpiredHold = (b, now = Date.now()) => {
  if (!isHoldBooking(b)) return false;
  const exp = holdExpiresAt(b);
  return !Number.isFinite(exp) || exp <= now;
};

/** Xóa các giữ chỗ đã hết hạn. Lỗi chỉ ghi log — dọn dẹp không được làm hỏng request chính. */
async function cleanupExpiredHolds(supabase, broadcast = () => { }) {
  try {
    const { data: holds, error } = await supabase
      .from('bookings')
      .select('id, status, internal_note, hold_expires_at, created_at')
      .eq('status', 'pending')
      .like('internal_note', `${HOLD_NOTE_PREFIX}%`);
    if (error) throw error;

    const now = Date.now();
    const expiredIds = (holds || []).filter(h => isExpiredHold(h, now)).map(h => h.id);
    if (expiredIds.length === 0) return [];

    const { error: delErr } = await supabase
      .from('bookings')
      .delete()
      .in('id', expiredIds)
      .eq('status', 'pending')
      .like('internal_note', `${HOLD_NOTE_PREFIX}%`);
    if (delErr) throw delErr;
    expiredIds.forEach(id => broadcast('booking.hold_released', { id }));
    return expiredIds;
  } catch (err) {
    console.error('[hold] Lỗi khi dọn giữ chỗ hết hạn:', err.message);
    return [];
  }
}

module.exports = { HOLD_NOTE_PREFIX, isHoldBooking, holdExpiresAt, isExpiredHold, cleanupExpiredHolds };
