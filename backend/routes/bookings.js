const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const webpush = require('web-push');
const bookingRateLimiter = require('../middleware/rateLimiter');
const { holdLimiter, getClientIp } = require('../middleware/security');
const { safeWebhookFetch } = require('../lib/safeUrl');
const { placeBookings, withMessages, summarizeConflicts, publicConflicts } = require('../lib/bookingEngine');
const { HOLD_NOTE_PREFIX, isHoldBooking, cleanupExpiredHolds } = require('../lib/holds');
const {
  MAX_ONLINE_GUESTS, OVER_GUEST_LIMIT_MESSAGE, normalizeVnPhone, supportsClientIp,
  releaseActiveHoldsForIp, checkSlotBudget, computeSpamFlag
} = require('../lib/antiSpam');
const { checkInBooking } = require('../lib/checkIn');
const { changeBooking } = require('../lib/bookingChange');
const { UNDO_RESTORE_FIELDS, UNDO_MAX_AGE_MS, fingerprintRow, verifyUndoAction } = require('../lib/undoToken');

// ---- Kiểm tra dữ liệu đầu vào (dùng cho request từ landing page / chưa đăng nhập) ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MAX_GUESTS = 10;
const MAX_HOLD_MS = 10 * 60 * 1000;

const isDateStr = (v) => typeof v === 'string' && DATE_RE.test(v) && !isNaN(new Date(v + 'T00:00:00').getTime());
const isTimeStr = (v) => typeof v === 'string' && TIME_RE.test(v);
const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function toGuestCount(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_GUESTS);
}

// Ngày đặt lịch hợp lệ cho khách tự đặt: từ hôm qua (lệch múi giờ) đến 120 ngày tới
function isReasonableBookingDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  const now = Date.now();
  return d >= now - 2 * 24 * 3600e3 && d <= now + 120 * 24 * 3600e3;
}


// Cấu hình thông số VAPID tiêu chuẩn cho web-push
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function getRelativeDateLabel(dateStr) {
  if (!dateStr) return '';
  const bookingDate = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const bookingTime = bookingDate.getTime();
  const todayTime = today.getTime();
  const tomorrowTime = tomorrow.getTime();
  const yesterdayTime = yesterday.getTime();

  if (bookingTime === todayTime) {
    return 'hôm nay';
  } else if (bookingTime === tomorrowTime) {
    return 'ngày mai';
  } else if (bookingTime === yesterdayTime) {
    return 'hôm qua';
  } else {
    const day = String(bookingDate.getDate()).padStart(2, '0');
    const month = String(bookingDate.getMonth() + 1).padStart(2, '0');
    return `ngày ${day}/${month}`;
  }
}



// Cache to deduplicate recent Web Push notifications (prevent multiple alerts for group bookings)
const recentPushCache = new Map();

// Clean up recent push cache every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentPushCache.entries()) {
    if (now - timestamp > 60000) {
      recentPushCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

async function notifyNewBooking(bookingData) {
  try {
    // 1) --- Deduplicate group booking push notifications ---
    // Deduplicate synchronously by group ID to prevent async race conditions
    if (bookingData.group_booking_id) {
      const groupKey = `group_${bookingData.group_booking_id}`;
      if (recentPushCache.has(groupKey)) return;
      recentPushCache.set(groupKey, Date.now());
    }

    let phone = bookingData.customers?.phone || bookingData.customer_phone || '';
    if (!phone && bookingData.customer_id) {
      const { data: cust } = await supabase.from('customers').select('phone').eq('id', bookingData.customer_id).single();
      if (cust) phone = cust.phone;
    }

    const date = bookingData.booking_date || '';
    const time = bookingData.start_time || '';

    // Fallback deduplication for non-group bookings (still vulnerable to async race if same phone/date/time sent concurrently, but handled above for groups)
    if (phone && date && time && !bookingData.group_booking_id) {
      const cacheKey = `${phone}_${date}_${time}`;
      const now = Date.now();
      const lastSent = recentPushCache.get(cacheKey);

      if (lastSent && (now - lastSent < 15000)) {
        return;
      }
      recentPushCache.set(cacheKey, now);
    }

    const { data: subscriptions, error: fetchErr } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (fetchErr) {
      console.error('[push] Không đọc được push_subscriptions:', fetchErr.message);
      return;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    // Deduplicate by endpoint: keep only the latest subscription per endpoint
    const uniqueByEndpoint = new Map();
    for (const sub of subscriptions) {
      uniqueByEndpoint.set(sub.endpoint, sub);
    }
    const uniqueSubs = Array.from(uniqueByEndpoint.values());
    const keepIds = new Set(uniqueSubs.map(s => s.id));

    // If duplicates were found, clean them up in the background
    if (uniqueSubs.length < subscriptions.length) {
      const duplicateIds = subscriptions
        .filter(sub => !keepIds.has(sub.id))
        .map(sub => sub.id);
      if (duplicateIds.length > 0) {
        supabase.from('push_subscriptions').delete().in('id', duplicateIds)
          .then(({ error }) => {
            if (error) console.error('[push] Không xóa được subscription trùng:', error.message);
          });
      }
    }
    // Phân tích dữ liệu khách hàng, dịch vụ và chi nhánh đồng bộ với Dashboard
    let customerName = bookingData.temporary_name || bookingData.customers?.name || bookingData.customer_name || '';
    let serviceName = bookingData.services?.name || bookingData.service_name || '';
    let branchName = bookingData.branches?.name || '';

    // Nếu thiếu, tự động truy vấn thêm từ Supabase để đảm bảo tên luôn hiển thị chính xác
    if (!customerName && bookingData.customer_id) {
      const { data: cust } = await supabase.from('customers').select('name').eq('id', bookingData.customer_id).single();
      if (cust) customerName = cust.name;
    }
    if (!serviceName && bookingData.service_id) {
      const { data: svc } = await supabase.from('services').select('name').eq('id', bookingData.service_id).single();
      if (svc) serviceName = svc.name;
    }
    if (!branchName && bookingData.branch_id) {
      const { data: br } = await supabase.from('branches').select('name').eq('id', bookingData.branch_id).single();
      if (br) branchName = br.name;
    }

    customerName = customerName || 'Khách Lạ';
    serviceName = serviceName || 'Dịch vụ';
    branchName = branchName || 'Chi nhánh';
    const startTime = bookingData.start_time || '';

    // 2.5) --- Save to database public.dashboard_notifications ---
    try {
      if (bookingData.id) {
        const { data: existingNotif } = await supabase
          .from('dashboard_notifications')
          .select('id')
          .eq('booking_id', bookingData.id)
          .limit(1);

        if (!existingNotif || existingNotif.length === 0) {
          const { error: dbErr } = await supabase
            .from('dashboard_notifications')
            .insert({
              booking_id: bookingData.id,
              title: 'Lịch hẹn mới! 🎉',
              customer_name: customerName,
              service_name: serviceName,
              branch_name: branchName,
              start_time: startTime,
              booking_date: bookingData.booking_date,
              read: false
            });

          if (dbErr) console.error('[push] Không lưu được dashboard_notifications cho lịch', bookingData.id, dbErr.message);
        }
      }

      // Tự động dọn dẹp các thông báo cũ hơn 30 ngày để tối ưu dung lượng DB
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      supabase
        .from('dashboard_notifications')
        .delete()
        .lt('created_at', thirtyDaysAgo.toISOString())
        .then(({ error: pruneErr }) => {
          if (pruneErr) console.error('[push] Không dọn được thông báo cũ:', pruneErr.message);
        });
    } catch (dbEx) {
      console.error('[push] Lỗi khi lưu thông báo dashboard:', dbEx.message);
    }

    const relativeDate = getRelativeDateLabel(bookingData.booking_date);
    const datePhrase = relativeDate ? ` vào ${relativeDate}` : '';
    const guestsPhrase = (bookingData.num_guests && bookingData.num_guests > 1) ? ` — ${bookingData.num_guests} người` : '';

    const payload = JSON.stringify({
      title: 'Ý Ơi! Có lịch mới nè 🌸',
      body: `${customerName} vừa đặt lịch ${serviceName} tại ${branchName} lúc ${startTime.substring(0, 5)}${datePhrase}${guestsPhrase}`,
      url: '/',
      branch_id: bookingData.branch_id
    });

    // Bỏ các thiết bị đã tắt thông báo của chi nhánh này (cột muted_branch_ids; chưa có cột → gửi hết như cũ).
    // Lọc ở server chứ không ở service worker: SW đăng ký userVisibleOnly nên nhận push là phải hiện thông báo.
    const recipients = uniqueSubs.filter(sub =>
      !(bookingData.branch_id && Array.isArray(sub.muted_branch_ids) && sub.muted_branch_ids.includes(bookingData.branch_id))
    );

    recipients.forEach(sub => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      webpush.sendNotification(pushConfig, payload)
        .catch(async (err) => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            // Thiết bị đã hủy đăng ký → xóa subscription (bình thường, không cần log)
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          } else {
            console.error('[push] Gửi Web Push thất bại:', err.statusCode || '', err.message);
          }
        });
    });
  } catch (err) {
    console.error('[push] Lỗi không mong muốn khi gửi thông báo lịch mới:', err.message);
  }
}


// Helper to get broadcastSSE from the app instance
function getBroadcast(req) {
  return req.app.get('broadcastSSE') || (() => { });
}

// Trả vướng mắc của booking engine. Khách online chỉ thấy loại vướng mắc (không lộ lịch của khách khác).
// result = kết quả không lưu được từ booking engine / Booking change / check-in: { conflicts, refused? }
function respondConflict(res, { conflicts = [], refused } = {}, { isPublic = false } = {}) {
  // Từ chối hẳn (VD vượt qua nửa đêm) → không hỏi "Vẫn lưu?"
  if (refused) return res.status(400).json({ code: refused.code, error: refused.message });
  if (isPublic) {
    const noBed = conflicts.some(c => c.type === 'no_bed') && !conflicts.some(c => c.type === 'no_employee');
    const tooLate = conflicts.some(c => c.type === 'after_last_booking');
    return res.status(409).json({
      code: 'BOOKING_CONFLICT',
      error: tooLate ? 'Đã quá giờ nhận khách của chi nhánh, vui lòng chọn giờ sớm hơn.'
        : noBed ? 'Không còn giường trống cho khung giờ này.' : 'Không có nhân viên trống cho khung giờ này.',
      conflicts: publicConflicts(conflicts)
    });
  }
  return res.status(409).json({ code: 'BOOKING_CONFLICT', error: summarizeConflicts(conflicts), conflicts: withMessages(conflicts) });
}

// Lịch thuộc nhóm mà không gửi scope → dashboard hỏi "Cả nhóm / Chỉ khách này" rồi gửi lại kèm scope
function respondScopeRequired(res, groupSize) {
  return res.status(409).json({
    code: 'SCOPE_REQUIRED',
    error: `Lịch này thuộc nhóm ${groupSize} khách — chọn "Cả nhóm" hoặc "Chỉ khách này".`,
    group_size: groupSize
  });
}

const scopeOf = (body) => (['booking', 'group'].includes(body?.scope) ? body.scope : undefined);

/**
 * GET /api/bookings
 * Query params: branch_id, date, status
 */
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('bookings')
      .select(`
        *,
        customers(id, name, phone, email, habits),
        services(name, duration_minutes, price, color),
        employees(name),
        beds(name),
        branches(name)
      `)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: true });

    if (req.query.branch_id) query = query.eq('branch_id', req.query.branch_id);
    if (req.query.date) query = query.eq('booking_date', req.query.date);
    if (req.query.date_from) query = query.gte('booking_date', req.query.date_from);
    if (req.query.date_to) query = query.lte('booking_date', req.query.date_to);
    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bookings/hold
 * Create a temporary slot hold
 */
router.post('/hold', holdLimiter, async (req, res) => {
  try {
    // Run cleanup first
    const broadcast = getBroadcast(req);
    await cleanupExpiredHolds(supabase, broadcast);

    const {
      branch_id, service_id, num_guests,
      booking_date, start_time, hold_duration
    } = req.body || {};

    if (!branch_id || !booking_date || !start_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof branch_id !== 'string' || (service_id && typeof service_id !== 'string') ||
      !isDateStr(booking_date) || !isTimeStr(start_time) || !isReasonableBookingDate(booking_date)) {
      return res.status(400).json({ error: 'Dữ liệu giữ chỗ không hợp lệ.' });
    }

    const guestCount = toGuestCount(num_guests);
    const isPublic = !req.auth;
    const ip = isPublic ? getClientIp(req) : null;

    // Chống spam (khách tự đặt): giới hạn số khách, 1 bộ giữ chỗ / IP, ngân sách slot theo IP
    if (isPublic) {
      if (guestCount > MAX_ONLINE_GUESTS) {
        return res.status(400).json({ code: 'TOO_MANY_GUESTS', error: OVER_GUEST_LIMIT_MESSAGE });
      }
      const releasedIds = await releaseActiveHoldsForIp(supabase, ip);
      releasedIds.forEach(id => broadcast('booking.hold_released', { id }));

      const budgetError = await checkSlotBudget(supabase, { ip, guestCount });
      if (budgetError) return res.status(429).json({ error: budgetError });
    }

    // 1) Resolve service-like data (duration + price)
    let duration = 60;
    let price = 0;
    let currentServiceId = service_id;

    if (currentServiceId) {
      const { data: service, error: serviceErr } = await supabase
        .from('services')
        .select('*')
        .eq('id', currentServiceId)
        .single();

      if (!serviceErr && service) {
        duration = service.duration_minutes || 60;
        price = service.price || 0;
      }
    } else {
      // Try to find "Giữ chỗ" service
      const { data: placeholderService } = await supabase
        .from('services')
        .select('*')
        .eq('name', 'Giữ chỗ')
        .eq('is_active', true)
        .maybeSingle();

      if (placeholderService) {
        currentServiceId = placeholderService.id;
        duration = placeholderService.duration_minutes || 60;
        price = placeholderService.price || 0;
      }
    }

    // Calculate end_time
    const startMinutes = timeToMinutes(start_time);
    const endMinutes = startMinutes + duration;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    const end_time = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    // 2) Find or create placeholder customer
    let customer;
    const placeholderPhone = '0000000000';
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', placeholderPhone)
      .maybeSingle();

    if (existingCustomer) {
      customer = existingCustomer;
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert([{ name: 'Giữ Chỗ Tạm Thời', phone: placeholderPhone, email: null }])
        .select()
        .single();

      if (custErr) throw custErr;
      customer = newCustomer;
    }

    // Giới hạn thời gian giữ chỗ tối đa 10 phút (trước đây client tự đặt bao lâu cũng được → khóa slot vĩnh viễn)
    const requestedMs = parseInt(hold_duration, 10);
    const durationMs = Number.isFinite(requestedMs) && requestedMs > 0
      ? Math.min(requestedMs, MAX_HOLD_MS)
      : 5 * 60 * 1000;
    const expiresAt = Date.now() + durationMs;

    const groupBookingId = guestCount > 1 ? crypto.randomUUID() : null;
    const clientIpField = ip && (await supportsClientIp(supabase)) ? { client_ip: ip } : {};

    // 3) Xếp NV + giường cho CẢ NHÓM theo quy tắc khách online (buffer, ca, giường, không chồng lịch),
    // ghi trong 1 transaction có khóa → 2 người giữ chỗ cùng lúc không lấy chung 1 NV / giường
    const items = Array.from({ length: guestCount }, (_, ref) => ({ ref, start: start_time, end: end_time, autoEmployee: true }));
    const result = await placeBookings(supabase, {
      source: 'web',
      branchId: branch_id,
      date: booking_date,
      items,
      build: (assignments) => ({
        inserts: assignments.map(({ employee_id, bed_id }) => ({
          customer_id: customer.id,
          service_id: currentServiceId || null,
          employee_id,
          bed_id,
          branch_id,
          num_guests: guestCount,
          booking_date,
          start_time,
          end_time,
          status: 'pending',
          total_price: price,
          internal_note: `${HOLD_NOTE_PREFIX} Giữ chỗ tạm thời cho khách đang đặt online. Tự động hủy lịch sau 5 phút. EXPIRES:${expiresAt}`,
          hold_expires_at: new Date(expiresAt).toISOString(),
          group_booking_id: groupBookingId,
          ...clientIpField
        }))
      })
    });
    if (!result.ok) return respondConflict(res, result, { isPublic: true });
    const createdHoldIds = result.ids;

    // Broadcast SSE for live dashboard updates
    createdHoldIds.forEach(id => {
      broadcast('booking.hold', { id });
    });

    res.status(201).json({ hold_ids: createdHoldIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bookings/hold
 * Cancel/release a hold booking (used when timer expires or user backs out)
 */
router.delete('/hold', async (req, res) => {
  try {
    const holdIdsRaw = req.query.hold_ids || req.body.hold_ids;
    if (!holdIdsRaw) {
      return res.status(400).json({ error: 'Missing hold_ids' });
    }

    const holdIds = (Array.isArray(holdIdsRaw)
      ? holdIdsRaw
      : String(holdIdsRaw).split(',').map(id => id.trim()))
      .filter(id => typeof id === 'string' && id)
      .slice(0, MAX_GUESTS);

    const { error } = await supabase
      .from('bookings')
      .delete()
      .in('id', holdIds)
      .eq('status', 'pending')
      .like('internal_note', '[GIỮ CHỖ TẠM THỜI]%');

    if (error) throw error;

    const broadcast = getBroadcast(req);
    if (typeof broadcast === 'function') {
      holdIds.forEach(id => {
        broadcast('booking.hold_released', { id });
      });
    }

    res.json({ message: 'Holds cancelled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bookings/undo
 * Hoàn tác các thao tác của AI chat. Body: { actions: [{ type, booking_ids, snapshot?, after, iat, uid, sig }] }
 * Action phải do chính server ký lúc AI thực hiện (xem lib/undoToken.js) — client không tự tạo/sửa được.
 *  - type 'create'                      → xóa các lịch vừa tạo (chỉ lịch tạo trong 24h và chưa hoàn thành)
 *  - type 'update' | 'check_in' | 'cancel' → khôi phục toàn bộ các trường từ snapshot (kể cả status)
 * Lịch đã bị thay đổi sau thao tác của AI (dấu vân tay khác `after`) sẽ bị bỏ qua, không ghi đè.
 * Các action được hoàn tác theo thứ tự ngược (thao tác sau cùng hoàn tác trước).
 */
const UNDO_VALID_STATUSES = ['pending', 'confirmed', 'arrived', 'completed', 'cancelled'];

router.post('/undo', async (req, res) => {
  try {
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    if (actions.length === 0 || actions.length > 20) {
      return res.status(400).json({ success: false, error: 'Không có thao tác hợp lệ để hoàn tác.' });
    }

    // Kiểm tra chữ ký của tất cả action trước khi ghi bất cứ thứ gì
    for (const action of actions) {
      const check = verifyUndoAction(action, req.auth?.id);
      if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    }

    const broadcast = getBroadcast(req);
    const restored = [];
    const deleted = [];
    const skipped = [];

    for (const action of [...actions].reverse()) {
      const ids = (Array.isArray(action?.booking_ids) ? action.booking_ids : [])
        .filter(id => typeof id === 'string')
        .slice(0, 50);
      if (ids.length === 0) continue;

      // Trạng thái hiện tại của các lịch — so với dấu vân tay `after` lúc AI vừa thực hiện
      const { data: currentRows, error: fetchErr } = await supabase
        .from('bookings')
        .select('*')
        .in('id', ids);
      if (fetchErr) throw fetchErr;
      const currentById = new Map((currentRows || []).map(r => [r.id, r]));
      const unchangedSinceAction = (id) => {
        const current = currentById.get(id);
        return !!current && fingerprintRow(current) === action.after[id];
      };

      if (action.type === 'create') {
        const deletable = ids.filter(id => {
          const r = currentById.get(id);
          return r
            && unchangedSinceAction(id)
            && Date.now() - new Date(r.created_at).getTime() < UNDO_MAX_AGE_MS
            && r.status !== 'completed';
        });
        skipped.push(...ids.filter(id => !deletable.includes(id)));

        if (deletable.length > 0) {
          const { error: delErr } = await supabase.from('bookings').delete().in('id', deletable);
          if (delErr) throw delErr;
          deletable.forEach(id => broadcast('booking.deleted', { id }));
          deleted.push(...deletable);
        }
      } else if (['update', 'check_in', 'cancel'].includes(action.type)) {
        const snapshot = Array.isArray(action.snapshot) ? action.snapshot : [];
        for (const row of snapshot) {
          // Chỉ khôi phục những lịch thuộc đúng action này
          if (!row || typeof row.id !== 'string' || !ids.includes(row.id)) continue;
          // Đã có người sửa lịch sau thao tác của AI (hoặc đã hoàn tác rồi) → không ghi đè
          if (!unchangedSinceAction(row.id)) {
            skipped.push(row.id);
            continue;
          }

          const patch = {};
          for (const field of UNDO_RESTORE_FIELDS) {
            if (field in row) patch[field] = row[field];
          }
          if (patch.status && !UNDO_VALID_STATUSES.includes(patch.status)) delete patch.status;
          if (Object.keys(patch).length === 0) continue;

          const { data: updated, error: updErr } = await supabase
            .from('bookings')
            .update(patch)
            .eq('id', row.id)
            .select(`
              *,
              customers(name, phone),
              services(name, duration_minutes, price, color),
              employees(name),
              beds(name),
              branches(name)
            `)
            .maybeSingle();
          if (updErr) throw updErr;

          if (updated) {
            broadcast('booking.updated', updated);
            restored.push(row.id);
          } else {
            skipped.push(row.id); // lịch đã bị xóa hẳn
          }
        }
      }
    }

    if (restored.length === 0 && deleted.length === 0) {
      return res.status(409).json({ success: false, error: 'Lịch hẹn đã thay đổi hoặc không còn tồn tại, không thể hoàn tác.' });
    }

    res.json({ success: true, restored, deleted, skipped });
  } catch (err) {
    console.error('[undo] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/bookings/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        customers(id, name, phone, email, habits),
        services(name, duration_minutes, price, color),
        employees(name),
        beds(name),
        branches(name)
      `)
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/bookings/:id — nhân viên sửa 1 lịch (sửa chi tiết, kéo thả trên lịch)
 * Body: { service_id, branch_id, start_time, employee_id (bắt buộc, null = chưa xếp NV),
 *         end_time?, booking_date?, notes?, internal_note?, customer_id?, temporary_name?,
 *         customer_update? { name, phone, email, habits }, allow_conflict? (đã bấm "Vẫn lưu"),
 *         scope? ('group' = Cả nhóm | 'booking' = Chỉ khách này) }
 * Adapter: dịch request thành 1 Booking change (lib/bookingChange).
 * Lịch thuộc nhóm đổi ngày / giờ mà không gửi scope → 409 SCOPE_REQUIRED (kèm group_size) để dashboard hỏi rồi gửi lại.
 */
router.put('/:id', async (req, res) => {
  try {
    const { service_id, branch_id, start_time, end_time, notes, customer_id, booking_date, internal_note, temporary_name, customer_update } = req.body;
    if (!service_id || !branch_id || !start_time || !('employee_id' in req.body)) {
      return res.status(400).json({ error: 'service_id, branch_id, start_time, employee_id are required' });
    }

    const result = await changeBooking(supabase, {
      source: 'staff',
      bookingId: req.params.id,
      scope: scopeOf(req.body),
      change: {
        service_id, branch_id, start_time, end_time, notes, customer_id, booking_date, internal_note, temporary_name, customer_update,
        // employee_id rỗng / null = lịch chưa xếp nhân viên (cột "Chưa xếp NV")
        employee_id: req.body.employee_id || null
      },
      confirm: req.body.allow_conflict === true,
      broadcast: getBroadcast(req)
    });
    if (result.code === 'SCOPE_REQUIRED') return respondScopeRequired(res, result.groupSize);
    if (result.code === 'BOOKING_CONFLICT') return respondConflict(res, result);
    if (!result.ok) return res.status(result.status).json({ code: result.code, error: result.error });

    res.json({ ...result.booking, oldBooking: result.before, group_updated_ids: result.groupUpdatedIds, group_failed_count: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bookings
 * Body:
 *   branch_id,
 *   service_id (nullable for Skip),
 *   duration_minutes (required if service_id is null),
 *   num_guests,
 *   customer_name, customer_phone, customer_email,
 *   booking_date, start_time, end_time, notes
 */
router.post('/', bookingRateLimiter, async (req, res) => {
  try {
    const isPublic = !req.auth;
    const ip = isPublic ? getClientIp(req) : null;
    const broadcast = getBroadcast(req);

    // Khách tự đặt từ landing page (chưa đăng nhập) → CHỈ nhận đúng các field khách được phép gửi.
    // Các field nội bộ (employee_id, temporary_name, customer_id, end_time, duration...) bị bỏ qua
    // để người ngoài không tự chọn nhân viên, sửa hồ sơ khách khác hay đặt giờ kết thúc tùy ý.
    if (isPublic) {
      const b = req.body || {};
      const name = cleanText(b.customer_name, 80);
      const phone = normalizeVnPhone(b.customer_phone);

      if (!name || !phone) {
        return res.status(400).json({ error: 'Vui lòng nhập họ tên và số điện thoại di động hợp lệ.' });
      }
      if (typeof b.branch_id !== 'string' || (b.service_id && typeof b.service_id !== 'string') ||
        !isDateStr(b.booking_date) || !isTimeStr(b.start_time) || !isReasonableBookingDate(b.booking_date)) {
        return res.status(400).json({ error: 'Thông tin đặt lịch không hợp lệ.' });
      }
      if (toGuestCount(b.num_guests) > MAX_ONLINE_GUESTS) {
        return res.status(400).json({ code: 'TOO_MANY_GUESTS', error: OVER_GUEST_LIMIT_MESSAGE });
      }

      const rawHoldIds = Array.isArray(b.hold_ids) ? b.hold_ids : (typeof b.hold_ids === 'string' ? [b.hold_ids] : []);
      const holdIds = rawHoldIds.filter(id => typeof id === 'string' && id).slice(0, MAX_GUESTS);

      req.body = {
        branch_id: b.branch_id,
        service_id: b.service_id || null,
        num_guests: toGuestCount(b.num_guests),
        customer_name: name,
        customer_phone: phone,
        // SĐT đúng như khách gõ — để tìm hồ sơ khách cũ lưu trước khi chuẩn hóa (VD "090 123 4567")
        customer_phone_raw: cleanText(b.customer_phone, 20),
        customer_email: cleanText(b.customer_email, 120) || null,
        booking_date: b.booking_date,
        start_time: b.start_time,
        notes: cleanText(b.notes, 500) || null,
        hold_ids: holdIds.length ? holdIds : undefined
      };
    }

    const {
      branch_id, service_id, duration_minutes, num_guests,
      customer_name, customer_phone, customer_email,
      booking_date, start_time, end_time: clientEndTime, notes,
      temporary_name
    } = req.body;

    if (!branch_id || (!customer_name && !temporary_name) || !booking_date || !start_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const guestCount = toGuestCount(num_guests);

    // Chống spam (chỉ khách tự đặt): ngân sách slot theo SĐT, rồi tính trạng thái/cảnh báo MỘT LẦN cho cả nhóm.
    // Làm trước khi tạo/sửa hồ sơ khách để request bị chặn không để lại dữ liệu.
    let spamFlag = { status: 'confirmed', internalNote: null };
    if (isPublic) {
      const phoneBudgetError = await checkSlotBudget(supabase, { phone: customer_phone, guestCount, checkIp: false });
      if (phoneBudgetError) return res.status(429).json({ error: phoneBudgetError });
      spamFlag = await computeSpamFlag(supabase, { ip, phone: customer_phone });
    }

    let isTemporary = false;
    let finalTemporaryName = temporary_name || null;

    if (finalTemporaryName) {
      isTemporary = true;
    } else if (!req.body.customer_id && !customer_phone && customer_name) {
      isTemporary = true;
      finalTemporaryName = customer_name;
    }

    // 1) Resolve service-like data (duration + price)
    let duration = null;
    let price = 0;

    if (service_id) {
      const { data: service, error: serviceErr } = await supabase
        .from('services')
        .select('*')
        .eq('id', service_id)
        .single();

      if (serviceErr || !service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      duration = service.duration_minutes;
      price = service.price || 0;
    } else {
      duration = parseInt(duration_minutes) || 60;
      price = 0;
    }

    // 2) Calculate end_time (Use client's end_time if provided)
    const startMinutes = timeToMinutes(start_time);
    const endMinutes = startMinutes + duration;

    let end_time = clientEndTime;
    if (!end_time) {
      const endH = Math.floor(endMinutes / 60);
      const endM = endMinutes % 60;
      end_time = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    }

    // 3) Find or create customer
    let customer = null;
    if (!isTemporary) {
      if (req.body.customer_id) {
        const { data: cById } = await supabase
          .from('customers')
          .select('*')
          .eq('id', req.body.customer_id)
          .single();
        if (cById) customer = cById;
      }

      if (!customer && customer_phone) {
        // Tìm theo cả dạng chuẩn hóa lẫn dạng khách gõ → khách cũ lưu SĐT có dấu cách không bị tạo hồ sơ trùng
        const phoneCandidates = [...new Set([customer_phone, req.body.customer_phone_raw].filter(Boolean))];
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('*')
          .in('phone', phoneCandidates)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (existingCustomer) {
          customer = existingCustomer;
        }
      }

      if (customer) {
        // Update customer info if changed
        if (customer_name !== customer.name || (customer_email && customer_email !== customer.email)) {
          const updateData = { name: customer_name };
          if (customer_email) updateData.email = customer_email;
          const { data: updated } = await supabase
            .from('customers')
            .update(updateData)
            .eq('id', customer.id)
            .select()
            .single();
          if (updated) customer = updated;
        }
      } else {
        const { data: newCustomer, error: custErr } = await supabase
          .from('customers')
          .insert([{ name: customer_name, phone: customer_phone || null, email: customer_email || null }])
          .select()
          .single();

        if (custErr) throw custErr;
        customer = newCustomer;
      }
    }

    const bookingSelect = `
      *,
      customers(name, phone, email),
      services(name, duration_minutes, price),
      employees(name),
      beds(name),
      branches(name)
    `;

    const respondCreated = (createdBookings, statusCode) => {
      const result = createdBookings.length === 1 ? createdBookings[0] : createdBookings;

      // Fire webhooks async
      const webhookEvent = createdBookings.some(b => b.status === 'pending') ? 'booking.pending' : 'booking.confirmed';
      fireWebhooks(webhookEvent, createdBookings).catch(err =>
        console.error('Webhook fire error:', err.message)
      );

      // Broadcast SSE for live dashboard updates
      createdBookings.forEach(b => {
        broadcast('booking.created', b);
      });

      return res.status(statusCode).json(result);
    };

    // --- Có hold_ids: chốt các lịch giữ chỗ thay vì tạo mới — CHỈ khi còn đủ giữ chỗ cho cả nhóm ---
    const holdIds = Array.isArray(req.body.hold_ids)
      ? req.body.hold_ids
      : (typeof req.body.hold_ids === 'string' ? [req.body.hold_ids] : []);

    const fetchCreated = async (ids) => {
      const { data, error } = await supabase.from('bookings').select(bookingSelect).in('id', ids);
      if (error) throw error;
      const byId = new Map((data || []).map(b => [b.id, b]));
      return ids.map(id => byId.get(id)).filter(Boolean);
    };

    if (holdIds.length > 0) {
      const { data: validHolds, error: holdErr } = await supabase
        .from('bookings')
        .select('id, employee_id, bed_id, start_time, end_time')
        .in('id', holdIds)
        .eq('status', 'pending')
        .like('internal_note', `${HOLD_NOTE_PREFIX}%`)
        .eq('branch_id', branch_id)
        .eq('booking_date', booking_date);
      if (holdErr) throw holdErr;

      const validIds = (validHolds || []).map(h => h.id);
      let leftoverIds = validIds;

      if (validIds.length === guestCount) {
        // Kiểm tra lại cả khi chốt: giữ chỗ đã hết hạn thì người khác có thể đã lấy NV / giường đó.
        // NV của giữ chỗ bận → không chốt được, nhả giữ chỗ và tạo mới bên dưới. Giường bận → tự đổi giường trống.
        const items = validHolds.map(h => ({
          ref: h.id, start: String(h.start_time).slice(0, 5), end: String(h.end_time).slice(0, 5),
          employeeId: h.employee_id, bedId: h.bed_id
        }));
        const result = await placeBookings(supabase, {
          source: 'web',
          branchId: branch_id,
          date: booking_date,
          items,
          excludeIds: validIds,
          build: (assignments) => ({
            updates: assignments.map(a => ({
              id: a.ref,
              set: {
                customer_id: isTemporary ? null : customer.id,
                temporary_name: isTemporary ? finalTemporaryName : null,
                status: spamFlag.status,
                notes: notes || null,
                internal_note: spamFlag.internalNote, // xóa ghi chú GIỮ CHỖ TẠM THỜI
                hold_expires_at: null,
                num_guests: guestCount,
                bed_id: a.bed_id
              }
            }))
          })
        });

        if (result.ok) {
          const confirmed = await fetchCreated(validIds);
          // Giữ chỗ bị dọn đúng lúc chốt (rất hiếm) → gỡ phần đã chốt, tạo lại đủ cả nhóm bên dưới
          if (confirmed.length === validIds.length && confirmed.every(b => !isHoldBooking(b))) {
            return respondCreated(confirmed, 200);
          }
          leftoverIds = confirmed.map(b => b.id);
        }
      }

      // Thiếu giữ chỗ (đã hết hạn / không khớp số khách / NV đã bị người khác lấy) → nhả phần còn lại, tạo mới bên dưới
      // (luồng tạo mới tự kiểm tra lại chỗ trống: còn chỗ thì khách vẫn đặt được, hết chỗ thì báo rõ ràng).
      if (leftoverIds.length > 0) {
        const { error: releaseErr } = await supabase.from('bookings').delete().in('id', leftoverIds);
        if (releaseErr) throw releaseErr;
        leftoverIds.forEach(id => broadcast('booking.hold_released', { id }));
      }
    }

    // Tạo mới từ landing page → kiểm tra ngân sách slot theo IP (khi chốt giữ chỗ thì đã tính lúc giữ chỗ)
    if (isPublic) {
      const ipBudgetError = await checkSlotBudget(supabase, { ip, guestCount });
      if (ipBudgetError) return res.status(429).json({ error: ipBudgetError });
    }

    // 4) Xếp NV + giường cho CẢ NHÓM qua booking engine, ghi trong 1 transaction có khóa theo ngày.
    //  - Khách online: buffer + ca + giường, không bao giờ chồng lịch.
    //  - Nhân viên: không buffer; NV được chọn (VD kéo tạo trên cột NV) được GIỮ ĐÚNG — bận / ngoài ca / hết giường /
    //    không ai rảnh → 409 BOOKING_CONFLICT, dashboard hỏi "Vẫn lưu?" rồi gửi lại kèm allow_conflict: true
    //    (không ai rảnh mà vẫn lưu → lịch chưa xếp NV).
    const groupBookingId = guestCount > 1 ? crypto.randomUUID() : null;
    const clientIpField = ip && (await supportsClientIp(supabase)) ? { client_ip: ip } : {};
    const items = Array.from({ length: guestCount }, (_, ref) => ({
      ref,
      start: start_time,
      end: end_time,
      employeeId: ref === 0 && !isPublic ? req.body.employee_id || null : null,
      autoEmployee: true,
      name: finalTemporaryName || customer_name
    }));

    const result = await placeBookings(supabase, {
      source: isPublic ? 'web' : 'staff',
      branchId: branch_id,
      date: booking_date,
      items,
      override: !isPublic && req.body.allow_conflict === true,
      build: (assignments) => ({
        inserts: assignments.map(({ employee_id, bed_id }) => ({
          customer_id: isTemporary ? null : customer.id,
          temporary_name: isTemporary ? finalTemporaryName : null,
          service_id: service_id || null,
          employee_id,
          bed_id,
          branch_id,
          num_guests: guestCount,
          booking_date,
          start_time,
          end_time,
          status: spamFlag.status,
          total_price: price,
          notes: notes || null,
          internal_note: spamFlag.internalNote,
          group_booking_id: groupBookingId,
          ...clientIpField
        }))
      })
    });
    if (!result.ok) return respondConflict(res, result, { isPublic });

    const createdBookings = await fetchCreated(result.ids);
    return respondCreated(createdBookings, 201);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/bookings/:id/status
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    // Get a snapshot of the booking before modifying its status
    const { data: oldBooking, error: snapErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (snapErr || !oldBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const { data, error } = await supabase
      .from('bookings')
      .update({ status })
      .eq('id', req.params.id)
      .select(`
        *,
        customers(name, phone, email),
        services(name, duration_minutes, price),
        employees(name),
        beds(name),
        branches(name)
      `)
      .single();

    if (error) throw error;

    // --- Automatic Tour Rotation ---
    if (status === 'completed' && data.employee_id && data.branch_id) {
      const tourKey = `tour_order_${data.branch_id}`;
      // Get current settings
      const { data: settingData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', tourKey)
        .single();

      if (settingData && Array.isArray(settingData.value)) {
        let tour = [...settingData.value];
        const idx = tour.indexOf(data.employee_id);
        if (idx !== -1) {
          // Remove from current position and push to the end
          tour.splice(idx, 1);
          tour.push(data.employee_id);

          await supabase
            .from('settings')
            .upsert({ key: tourKey, value: tour }, { onConflict: 'key' });
        }
      }
    }

    // Broadcast SSE for live dashboard updates
    const broadcast = getBroadcast(req);
    broadcast('booking.updated', data);

    // Send the updated data along with the status snapshot
    res.json({
      ...data,
      oldBooking
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bookings/:id/check-in — khách đã đến (dùng chung logic với AI check_in_booking)
 * Body: { allow_conflict?, scope? ('group' = Cả nhóm | 'booking' = Chỉ khách này) }
 * Lịch thuộc nhóm mà không gửi scope → 409 SCOPE_REQUIRED (kèm group_size).
 * Giờ mới chồng lên lịch kế tiếp của NV hoặc trễ hơn Last booking time + Late arrival grace → 409 BOOKING_CONFLICT;
 * gửi lại kèm allow_conflict: true sau "Vẫn lưu".
 */
router.post('/:id/check-in', async (req, res) => {
  try {
    const result = await checkInBooking(req.params.id, getBroadcast(req), {
      source: 'staff',
      scope: scopeOf(req.body),
      override: req.body?.allow_conflict === true
    });
    if (result.error) return res.status(404).json({ error: result.error });
    if (result.scopeRequired) return respondScopeRequired(res, result.groupSize);
    if (result.blocked) return respondConflict(res, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bookings/:id
 * Query: group=1 → xóa luôn các lịch cùng nhóm (group_booking_id).
 * Chỉ xóa 1 người trong nhóm → cập nhật num_guests của những người còn lại cho đúng số thực tế.
 */
router.delete('/:id', async (req, res) => {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, group_booking_id')
      .eq('id', req.params.id)
      .maybeSingle();

    const groupId = booking?.group_booking_id || null;
    const deleteWholeGroup = groupId && (req.query.group === '1' || req.query.group === 'true');

    let query = supabase.from('bookings').delete();
    query = deleteWholeGroup ? query.eq('group_booking_id', groupId) : query.eq('id', req.params.id);
    const { data: deletedRows, error } = await query.select('id');

    if (error) throw error;
    const deletedIds = (deletedRows || []).map(r => r.id);
    if (deletedIds.length === 0) deletedIds.push(req.params.id);

    const broadcast = getBroadcast(req);

    if (groupId && !deleteWholeGroup) {
      const { data: remaining, error: remErr } = await supabase
        .from('bookings')
        .select('id')
        .eq('group_booking_id', groupId)
        .neq('status', 'cancelled');
      if (!remErr && remaining?.length) {
        const { error: countErr } = await supabase
          .from('bookings')
          .update({ num_guests: remaining.length })
          .in('id', remaining.map(r => r.id));
        if (countErr) console.warn('[bookings DELETE] Không cập nhật được num_guests của nhóm:', countErr.message);
        else remaining.forEach(r => broadcast('booking.updated', { id: r.id, num_guests: remaining.length }));
      }
    }

    // Broadcast SSE for live dashboard updates
    deletedIds.forEach(id => broadcast('booking.deleted', { id }));

    res.json({ message: 'Booking deleted successfully', deleted_ids: deletedIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function timeToMinutes(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

async function fireWebhooks(event, bookings) {
  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('*')
    .eq('event', event)
    .eq('is_active', true);

  if (!webhooks || webhooks.length === 0) return;

  const bookingList = Array.isArray(bookings) ? bookings : [bookings];

  for (const webhook of webhooks) {
    for (const booking of bookingList) {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data: {
          booking_id: booking.id,
          customer_name: booking.customers?.name || '',
          customer_phone: booking.customers?.phone || '',
          customer_email: booking.customers?.email || '',
          service_name: booking.services?.name || '',
          service_duration: booking.services?.duration_minutes || 0,
          service_price: booking.services?.price || 0,
          employee_name: booking.employees?.name || '',
          bed_name: booking.beds?.name || '',
          branch_name: booking.branches?.name || '',
          booking_date: booking.booking_date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          status: booking.status,
          total_price: booking.total_price,
          num_guests: booking.num_guests,
          notes: booking.notes
        }
      };

      try {
        // safeWebhookFetch: chỉ gọi địa chỉ https công khai, timeout 5s (chống SSRF vào mạng nội bộ)
        await safeWebhookFetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.warn(`[webhook] Gửi tới "${webhook.name}" thất bại:`, err.message);
      }
    }
  }
}

router.notifyNewBooking = notifyNewBooking;
module.exports = router;