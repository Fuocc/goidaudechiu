const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const webpush = require('web-push');
const bookingRateLimiter = require('../middleware/rateLimiter');


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
          .then(() => console.log('✅ Duplicate subscriptions cleaned up'))
          .catch(err => console.error('❌ Failed to clean duplicates:', err));
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

          if (dbErr) {
          } else {
          }
        } else {
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
          if (pruneErr) console.error('❌ Error pruning old notifications:', pruneErr);
        });
    } catch (dbEx) {
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

    uniqueSubs.forEach(sub => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      webpush.sendNotification(pushConfig, payload)
        .then(() => console.log('✅ Push sent to endpoint:', sub.endpoint.slice(-30)))
        .catch(async (err) => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          }
        });
    });
  } catch (err) {
  }
}


// Helper to get broadcastSSE from the app instance
function getBroadcast(req) {
  return req.app.get('broadcastSSE') || (() => { });
}

// Normalize Vietnamese diacritics for Latin search
const normalize = (str) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
router.post('/hold', async (req, res) => {
  try {
    // Run cleanup first
    const broadcast = getBroadcast(req);
    await cleanupExpiredHolds(broadcast);

    const {
      branch_id, service_id, num_guests,
      booking_date, start_time, hold_duration
    } = req.body;

    if (!branch_id || !booking_date || !start_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const guestCount = parseInt(num_guests) || 1;

    // 1) Resolve service-like data (duration + price)
    let resolvedService = null;
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
        resolvedService = service;
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
        resolvedService = placeholderService;
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

    // 3) Load existing bookings in branch/day (including other holds!)
    const { data: dayBookings, error: dayErr } = await supabase
      .from('bookings')
      .select('employee_id, bed_id, start_time, end_time')
      .eq('branch_id', branch_id)
      .eq('booking_date', booking_date)
      .neq('status', 'cancelled');

    if (dayErr) throw dayErr;

    // 4) Load active employees
    const { data: allEmployees, error: empErr } = await supabase
      .from('employees')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('is_active', true);

    if (empErr) throw empErr;

    // Apply schedule rules
    const empIds = allEmployees.map(e => e.id);
    let schedules = [];
    if (empIds.length > 0) {
      const { data: schedData, error: schedErr } = await supabase
        .from('employee_schedules')
        .select('employee_id, start_time, end_time, is_day_off')
        .in('employee_id', empIds)
        .eq('date', booking_date);

      if (schedErr) throw schedErr;
      schedules = schedData || [];
    }
    const scheduleByEmp = new Map();
    for (const s of schedules) scheduleByEmp.set(s.employee_id, s);

    const employees = allEmployees.filter(e => {
      const s = scheduleByEmp.get(e.id);
      if (!s) return false;
      if (s.is_day_off) return false;
      if (!s.start_time || !s.end_time) return false;

      const sStart = timeToMinutes(String(s.start_time).substring(0, 5));
      const sEnd = timeToMinutes(String(s.end_time).substring(0, 5));
      return startMinutes >= sStart && endMinutes <= sEnd;
    });

    if (employees.length < guestCount) {
      return res.status(409).json({ error: 'Không đủ nhân viên cho khung giờ này.' });
    }

    // 5) Load active beds
    const { data: beds, error: bedErr } = await supabase
      .from('beds')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('is_active', true);

    if (bedErr) throw bedErr;

    // 6) Assign employee & bed
    const { data: settingsData } = await supabase.from('settings').select('*');
    const settings = (settingsData || []).reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    const bufferTime = parseInt(settings.buffer_time) || 15;
    const tourOrder = settings[`tour_order_${branch_id}`] || [];

    const createdHoldIds = [];
    const assignedEmpIds = [];
    const assignedBedIds = [];

    const crypto = require('crypto');
    const groupBookingId = guestCount > 1 ? crypto.randomUUID() : null;

    for (let g = 0; g < guestCount; g++) {
      const busyEmployeeIds = new Set();
      // Combine dayBookings with already created holds in this loop to prevent double assignment of the same staff/bed
      const allRelevantBookings = [...dayBookings, ...createdHoldIds.map(id => {
        return {
          employee_id: employees.find(emp => emp.id === createdHoldIds[g - 1])?.id, // fallback/mock
          bed_id: beds[0]?.id // mock
        };
      })];

      for (const booking of dayBookings) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time) + bufferTime;
        if (startMinutes < bEnd && bStart < endMinutes) {
          busyEmployeeIds.add(booking.employee_id);
        }
      }

      const availableEmployees = employees.filter(e => !busyEmployeeIds.has(e.id) && !assignedEmpIds.includes(e.id));
      if (availableEmployees.length === 0) {
        return res.status(409).json({ error: 'Không có nhân viên trống cho khung giờ này.' });
      }

      availableEmployees.sort((a, b) => {
        const idxA = tourOrder.indexOf(a.id);
        const idxB = tourOrder.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });

      const assignedEmployee = availableEmployees[0];
      assignedEmpIds.push(assignedEmployee.id);

      // Beds
      const busyBedIds = new Set();
      for (const booking of dayBookings) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time);
        if (startMinutes < bEnd && bStart < endMinutes) {
          busyBedIds.add(booking.bed_id);
        }
      }

      const availableBeds = beds.filter(b => !busyBedIds.has(b.id) && !assignedBedIds.includes(b.id));
      if (availableBeds.length === 0) {
        return res.status(409).json({ error: 'Không còn giường trống cho khung giờ này.' });
      }

      const bedBookingCount = {};
      for (const bed of beds) bedBookingCount[bed.id] = 0;
      for (const booking of dayBookings) {
        if (bedBookingCount[booking.bed_id] !== undefined) bedBookingCount[booking.bed_id]++;
      }

      availableBeds.sort((a, b) => (bedBookingCount[a.id] || 0) - (bedBookingCount[b.id] || 0));
      const assignedBed = availableBeds[0];
      assignedBedIds.push(assignedBed.id);

      const durationMs = parseInt(hold_duration) || (5 * 60 * 1000);
      const expiresAt = Date.now() + durationMs;

      const insertPayload = {
        customer_id: customer.id,
        service_id: currentServiceId || null,
        employee_id: assignedEmployee.id,
        bed_id: assignedBed.id,
        branch_id,
        num_guests: guestCount,
        booking_date,
        start_time,
        end_time,
        status: 'pending',
        total_price: price,
        internal_note: `[GIỮ CHỖ TẠM THỜI] Giữ chỗ tạm thời cho khách đang đặt online. Tự động hủy lịch sau 5 phút. EXPIRES:${expiresAt}`,
        group_booking_id: groupBookingId
      };


      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .insert([insertPayload])
        .select()
        .single();

      if (bookErr) throw bookErr;
      createdHoldIds.push(booking.id);
    }

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

    const holdIds = Array.isArray(holdIdsRaw)
      ? holdIdsRaw
      : String(holdIdsRaw).split(',').map(id => id.trim());

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
 * PUT /api/bookings/:id
 * Update booking detail (service, branch, start_time, employee)
 * Body: { service_id, branch_id, start_time, employee_id }
 */
router.put('/:id', async (req, res) => {
  try {
    const { service_id, branch_id, start_time, end_time: clientEndTime, employee_id, notes, customer_id, booking_date, internal_note, temporary_name } = req.body;

    // Basic validation
    if (!service_id || !branch_id || !start_time || !employee_id) {
      return res.status(400).json({ error: 'service_id, branch_id, start_time, employee_id are required' });
    }

    // 1) Load booking
    const { data: booking, error: bkErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (bkErr || !booking) return res.status(404).json({ error: 'Booking not found' });

    // 2) Load service (duration/price)
    const { data: service, error: svcErr } = await supabase
      .from('services')
      .select('id, duration_minutes, price')
      .eq('id', service_id)
      .single();

    if (svcErr || !service) return res.status(404).json({ error: 'Service not found' });

    // 3) Validate branch exists
    const { data: branch, error: brErr } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branch_id)
      .single();

    if (brErr || !branch) return res.status(404).json({ error: 'Branch not found' });

    // 4) Validate employee exists and belongs to branch
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('id, branch_id, is_active')
      .eq('id', employee_id)
      .single();

    if (empErr || !emp) return res.status(404).json({ error: 'Employee not found' });
    if (!emp.is_active) return res.status(409).json({ error: 'Employee is inactive' });
    if (emp.branch_id !== branch_id) {
      return res.status(409).json({ error: 'Employee does not belong to selected branch' });
    }

    // 5) Recalculate end_time & price (Use client's end_time if provided)
    let end_time = clientEndTime;
    if (!end_time) {
      const startMinutes = timeToMinutes(start_time);
      const endMinutes = startMinutes + (service.duration_minutes || 60);
      const endH = Math.floor(endMinutes / 60);
      const endM = endMinutes % 60;
      end_time = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    }

    // NOTE: total_price in your create flow is stored as service.price (not * num_guests)
    const total_price = service.price || 0;

    // 6) Update
    const { data: updated, error: upErr } = await supabase
      .from('bookings')
      .update({
        service_id,
        branch_id,
        employee_id,
        customer_id: customer_id !== undefined ? customer_id : booking.customer_id,
        temporary_name: temporary_name !== undefined ? temporary_name : booking.temporary_name,
        booking_date: booking_date !== undefined ? booking_date : booking.booking_date,
        start_time,
        end_time,
        total_price,
        notes: notes !== undefined ? notes : booking.notes,
        internal_note: internal_note !== undefined ? internal_note : booking.internal_note
      })
      .eq('id', req.params.id)
      .select(`
        *,
        customers(name, phone, email, habits),
        services(name, duration_minutes, price),
        employees(name),
        beds(name),
        branches(name)
      `)
      .single();

    if (upErr) throw upErr;

    // Broadcast SSE for live dashboard updates
    const broadcast = getBroadcast(req);
    broadcast('booking.updated', updated);

    res.json(updated);
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
    const {
      branch_id, service_id, duration_minutes, num_guests,
      customer_name, customer_phone, customer_email,
      booking_date, start_time, end_time: clientEndTime, notes,
      temporary_name
    } = req.body;

    if (!branch_id || (!customer_name && !temporary_name) || !booking_date || !start_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const guestCount = parseInt(num_guests) || 1;

    let isTemporary = false;
    let finalTemporaryName = temporary_name || null;

    if (finalTemporaryName) {
      isTemporary = true;
    } else if (!req.body.customer_id && !customer_phone && customer_name) {
      isTemporary = true;
      finalTemporaryName = customer_name;
    }

    // 1) Resolve service-like data (duration + price)
    let resolvedService = null;
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

      resolvedService = service;
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
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('*')
          .eq('phone', customer_phone)
          .single();

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

    // --- If hold_ids are provided, update them instead of creating new bookings ---
    if (req.body.hold_ids && (Array.isArray(req.body.hold_ids) || typeof req.body.hold_ids === 'string')) {
      const ids = Array.isArray(req.body.hold_ids) ? req.body.hold_ids : [req.body.hold_ids];
      const updatedBookings = [];

      for (const id of ids) {
        // --- Anti-Spam Check ---
        let bookingStatus = 'confirmed';
        let internalNote = null;

        const isWalkIn = !isTemporary && normalize(customer_name).includes('khach la') && (!customer_phone || /^0+$/.test(customer_phone));

        if (!isTemporary && !isWalkIn && customer_phone) {
          try {
            const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const { data: recentBookings, error: recentErr } = await supabase
              .from('bookings')
              .select('id, created_at, customers!inner(phone)')
              .eq('customers.phone', customer_phone)
              .gte('created_at', thirtyMinAgo);

            if (!recentErr && recentBookings && recentBookings.length > 0) {
              bookingStatus = 'pending';
              internalNote = `⚠️ Khách hàng ${customer_phone} đã có ${recentBookings.length} đơn trong 30 phút qua. Vui lòng xác nhận qua điện thoại.`;
            }
          } catch (spamCheckErr) {
          }
        }

        const { data: updated, error: upErr } = await supabase
          .from('bookings')
          .update({
            customer_id: isTemporary ? null : customer.id,
            temporary_name: isTemporary ? finalTemporaryName : null,
            status: bookingStatus,
            notes: notes || null,
            internal_note: internalNote // clear the GIỮ CHỖ TẠM THỜI note!
          })
          .eq('id', id)
          .select(`
            *,
            customers(name, phone, email),
            services(name, duration_minutes, price),
            employees(name),
            beds(name),
            branches(name)
          `)
          .single();

        if (!upErr && updated) {
          updatedBookings.push(updated);
        }
      }

      if (updatedBookings.length > 0) {
        const result = updatedBookings.length === 1 ? updatedBookings[0] : updatedBookings;

        // Fire webhooks async
        const webhookEvent = updatedBookings.some(b => b.status === 'pending') ? 'booking.pending' : 'booking.confirmed';
        fireWebhooks(webhookEvent, updatedBookings).catch(err =>
          console.error('Webhook fire error:', err.message)
        );

        // Broadcast SSE for live dashboard updates
        const broadcast = getBroadcast(req);
        updatedBookings.forEach(b => {
          broadcast('booking.created', b);
        });

        return res.status(200).json(result);
      }
    }

    // 4) Load existing bookings in branch/day
    const { data: dayBookings, error: dayErr } = await supabase
      .from('bookings')
      .select('employee_id, bed_id, start_time, end_time')
      .eq('branch_id', branch_id)
      .eq('booking_date', booking_date)
      .neq('status', 'cancelled');

    if (dayErr) throw dayErr;

    // 5) Load active employees
    const { data: allEmployees, error: empErr } = await supabase
      .from('employees')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('is_active', true);

    if (empErr) throw empErr;

    // 5.1) Apply schedule rule: employee must have schedule record for that date (not day off)
    const empIds = allEmployees.map(e => e.id);
    let schedules = [];
    if (empIds.length > 0) {
      const { data: schedData, error: schedErr } = await supabase
        .from('employee_schedules')
        .select('employee_id, start_time, end_time, is_day_off')
        .in('employee_id', empIds)
        .eq('date', booking_date);

      if (schedErr) throw schedErr;
      schedules = schedData || [];
    }
    const scheduleByEmp = new Map();
    for (const s of schedules) scheduleByEmp.set(s.employee_id, s);

    const employees = allEmployees.filter(e => {
      const s = scheduleByEmp.get(e.id);
      if (!s) return false;         // missing => unavailable (deleted)
      if (s.is_day_off) return false;
      if (!s.start_time || !s.end_time) return false;

      const sStart = timeToMinutes(String(s.start_time).substring(0, 5));
      const sEnd = timeToMinutes(String(s.end_time).substring(0, 5));
      return startMinutes >= sStart && endMinutes <= sEnd;
    });

    if (employees.length < guestCount) {
      return res.status(409).json({ error: 'Not enough employees available for this day' });
    }

    // 6) Load active beds
    const { data: beds, error: bedErr } = await supabase
      .from('beds')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('is_active', true);

    if (bedErr) throw bedErr;

    // 7) Create bookings for each guest (auto assign employee/bed)
    const createdBookings = [];

    // 7.0) Load settings (buffer time and tour order)
    const { data: settingsData } = await supabase.from('settings').select('*');
    const settings = (settingsData || []).reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    const bufferTime = parseInt(settings.buffer_time) || 15;
    const tourOrder = settings[`tour_order_${branch_id}`] || [];

    const crypto = require('crypto');
    const groupBookingId = guestCount > 1 ? crypto.randomUUID() : null;

    for (let g = 0; g < guestCount; g++) {
      const busyEmployeeIds = new Set();
      const allRelevantBookings = [...dayBookings, ...createdBookings.map(b => ({
        employee_id: b.employee_id,
        bed_id: b.bed_id,
        start_time: b.start_time,
        end_time: b.end_time
      }))];

      for (const booking of allRelevantBookings) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time) + bufferTime;
        if (startMinutes < bEnd && bStart < endMinutes) {
          busyEmployeeIds.add(booking.employee_id);
        }
      }

      const availableEmployees = employees.filter(e => !busyEmployeeIds.has(e.id));
      if (availableEmployees.length === 0) {
        return res.status(409).json({ error: 'No employees available for this time slot' });
      }

      // Sort by Tour Order from Settings
      availableEmployees.sort((a, b) => {
        const idxA = tourOrder.indexOf(a.id);
        const idxB = tourOrder.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });

      let assignedEmployee = availableEmployees[0];

      // If employee_id is explicitly requested (e.g. from admin click), try to use it for the first guest
      if (g === 0 && req.body.employee_id) {
        const requestedEmp = availableEmployees.find(e => e.id === req.body.employee_id);
        if (requestedEmp) {
          assignedEmployee = requestedEmp;
        }
      }

      // Beds
      const busyBedIds = new Set();
      for (const booking of allRelevantBookings) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time);
        if (startMinutes < bEnd && bStart < endMinutes) {
          busyBedIds.add(booking.bed_id);
        }
      }

      const availableBeds = beds.filter(b => !busyBedIds.has(b.id));
      if (availableBeds.length === 0) {
        return res.status(409).json({ error: 'No beds available for this time slot' });
      }

      const bedBookingCount = {};
      for (const bed of beds) bedBookingCount[bed.id] = 0;
      for (const booking of allRelevantBookings) {
        if (bedBookingCount[booking.bed_id] !== undefined) bedBookingCount[booking.bed_id]++;
      }

      availableBeds.sort((a, b) => (bedBookingCount[a.id] || 0) - (bedBookingCount[b.id] || 0));
      const assignedBed = availableBeds[0];

      // --- Anti-Spam Check: query recent bookings by same phone in last 30 min ---
      // Skip for "Khách Lạ" (walk-in) customers with placeholder phone numbers
      let bookingStatus = 'confirmed';
      let internalNote = null;

      const isWalkIn = !isTemporary && normalize(customer_name).includes('khach la') && (!customer_phone || /^0+$/.test(customer_phone));

      if (!isTemporary && !isWalkIn && customer_phone) {
        try {
          const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          
          const { data: oldBookings } = await supabase
            .from('bookings')
            .select('id, customers!inner(phone)')
            .eq('customers.phone', customer_phone)
            .lt('created_at', thirtyMinAgo)
            .limit(1);

          const isOldCustomer = oldBookings && oldBookings.length > 0;

          if (!isOldCustomer) {
            const { data: recentBookings, error: recentErr } = await supabase
              .from('bookings')
              .select('id, created_at, customers!inner(phone)')
              .eq('customers.phone', customer_phone)
              .gte('created_at', thirtyMinAgo);

            if (!recentErr && recentBookings && recentBookings.length > 0) {
              bookingStatus = 'pending';
              internalNote = `⚠️ Khách hàng ${customer_phone} đã có ${recentBookings.length} đơn trong 30 phút qua. Vui lòng xác nhận qua điện thoại.`;
            }
          }
        } catch (spamCheckErr) {
          // Don't block booking if spam check fails, just log
        }
      }

      // Create booking row
      const insertPayload = {
        customer_id: isTemporary ? null : customer.id,
        temporary_name: isTemporary ? finalTemporaryName : null,
        service_id: service_id || null,
        employee_id: assignedEmployee.id,
        bed_id: assignedBed.id,
        branch_id,
        num_guests: guestCount,
        booking_date,
        start_time,
        end_time,
        status: bookingStatus,
        total_price: price,
        notes: notes || null,
        internal_note: internalNote,
        group_booking_id: groupBookingId
      };


      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .insert([insertPayload])
        .select(`
          *,
          customers(name, phone, email),
          services(name, duration_minutes, price),
          employees(name),
          beds(name),
          branches(name)
        `)
        .single();

      if (bookErr) throw bookErr;
      createdBookings.push(booking);
    }

    const result = createdBookings.length === 1 ? createdBookings[0] : createdBookings;

    // Fire webhooks async (keep your old logic)
    const webhookEvent = createdBookings.some(b => b.status === 'pending') ? 'booking.pending' : 'booking.confirmed';
    fireWebhooks(webhookEvent, createdBookings).catch(err =>
      console.error('Webhook fire error:', err.message)
    );

    // Broadcast SSE for live dashboard updates
    const broadcast = getBroadcast(req);
    createdBookings.forEach(b => {
      broadcast('booking.created', b);
    });

    res.status(201).json(result);
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

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bookings/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    // Broadcast SSE for live dashboard updates
    const broadcast = getBroadcast(req);
    broadcast('booking.deleted', { id: req.params.id });

    res.json({ message: 'Booking deleted successfully' });
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
        await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
      }
    }
  }
}

async function cleanupExpiredHolds(broadcast) {
  try {
    const { data: holds, error } = await supabase
      .from('bookings')
      .select('id, internal_note')
      .eq('status', 'pending')
      .like('internal_note', '[GIỮ CHỖ TẠM THỜI]%');

    if (!error && holds && holds.length > 0) {
      const now = Date.now();
      const expiredIds = [];

      for (const hold of holds) {
        if (!hold.internal_note) {
          expiredIds.push(hold.id);
          continue;
        }
        const match = hold.internal_note.match(/EXPIRES:(\d+)/);
        if (match) {
          const expiresAt = parseInt(match[1]);
          if (now >= expiresAt) {
            expiredIds.push(hold.id);
          }
        } else {
          // Fallback if no EXPIRES tag is present (older records)
          const matchTime = hold.internal_note.match(/\[SLOT_HOLD\]\s+(\d+)/);
          if (matchTime) {
            const createdAt = parseInt(matchTime[1]);
            if (now - createdAt >= 5 * 60 * 1000) {
              expiredIds.push(hold.id);
            }
          } else {
            expiredIds.push(hold.id);
          }
        }
      }

      if (expiredIds.length > 0) {
        await supabase.from('bookings').delete().in('id', expiredIds);
        if (typeof broadcast === 'function') {
          expiredIds.forEach(id => {
            broadcast('booking.hold_released', { id });
          });
        }
      }
    }
  } catch (err) {
  }
}

router.notifyNewBooking = notifyNewBooking;
module.exports = router;