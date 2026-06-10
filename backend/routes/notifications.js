const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const supabase = require('../supabaseClient');

// Cấu hình thông số VAPID tiêu chuẩn cho web-push
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// API GET: Lấy Public Key để client sử dụng khi đăng ký
router.get('/vapid-public-key', (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(500).json({ error: 'Chưa cấu hình VAPID Public Key ở Server' });
    }
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// API POST: Đăng ký thiết bị nhận thông báo push (Subscribe)
router.post('/subscribe', async (req, res) => {
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: 'Dữ liệu Subscription không hợp lệ' });
    }

    const { endpoint, keys: { p256dh, auth } } = subscription;

    try {
        // Lưu thông tin đăng ký vào bảng push_subscriptions trong database Supabase
        const { data, error } = await supabase
            .from('push_subscriptions')
            .upsert(
                { endpoint, p256dh, auth },
                { onConflict: 'endpoint' }
            )
            .select();

        if (error) throw error;
        res.status(201).json({ message: 'Đăng ký nhận thông báo đẩy thành công!' });
    } catch (err) {
        res.status(500).json({ error: 'Không thể đăng ký nhận tin trên máy chủ' });
    }
});

// API POST: Hủy đăng ký thiết bị (Unsubscribe)
router.post('/unsubscribe', async (req, res) => {
    const { endpoint } = req.body;

    if (!endpoint) {
        return res.status(400).json({ error: 'Thiếu thông số endpoint để huỷ đăng ký' });
    }

    try {
        const { error } = await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', endpoint);

        if (error) throw error;
        res.json({ message: 'Đã hủy đăng ký nhận thông báo!' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ khi hủy đăng ký nhận tin' });
    }
});

// API POST: Gửi thông báo test cho tất cả các thiết bị đang đăng ký
router.post('/send-test', async (req, res) => {
    const { title, body } = req.body;

    try {
        const { data: subscriptions, error } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (error) throw error;

        if (!subscriptions || subscriptions.length === 0) {
            return res.status(200).json({ message: 'Không có thiết bị nào đang đăng ký nhận tin' });
        }

        // Deduplicate by endpoint to prevent sending to the same browser multiple times
        const uniqueByEndpoint = new Map();
        for (const sub of subscriptions) {
            uniqueByEndpoint.set(sub.endpoint, sub);
        }
        const uniqueSubs = Array.from(uniqueByEndpoint.values());
        const keepIds = new Set(uniqueSubs.map(s => s.id));

        // Clean up duplicates in the background
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

        const payload = JSON.stringify({
            title: title || 'Ý Ơi ơi! Có tin nhắn test nè 🌸',
            body: body || 'Ủa chứ chưa có ai đặt lịch hết trơn á, đây chỉ là tin nhắn gửi thử để cục dàng thấy là hệ thống Web Push đang hoạt động dễ chịu vô cùng đó nghen! ✨',
            url: '/'
        });

        const sendPromises = uniqueSubs.map(sub => {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            return webpush.sendNotification(pushConfig, payload)
                .catch(async (err) => {
                    // Nếu nhận mã lỗi 410 (Gone) hoặc 404, nghĩa là endpoint đó đã hết hạn / người dùng đã block nhận tin.
                    // Cần xóa endpoint này khỏi DB để tối ưu hóa hiệu năng
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                    } else {
                    }
                });
        });

        await Promise.all(sendPromises);
        res.json({ message: `Đã gửi thông báo đến ${uniqueSubs.length} thiết bị nhận.` });
    } catch (err) {
        res.status(500).json({ error: 'Thất bại khi gửi thông báo test' });
    }
});

// ---- Dashboard Notifications Endpoints (Bypasses Frontend RLS via Service Role Key) ----

// GET /api/notifications/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const { data: notifications, error } = await supabase
            .from('dashboard_notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (!notifications || notifications.length === 0) {
            return res.json([]);
        }

        // Gộp danh sách các booking_id
        const bookingIds = notifications
            .map(n => n.booking_id)
            .filter(id => !!id);

        let bookingsMap = {};
        if (bookingIds.length > 0) {
            const { data: bookingsData, error: bkError } = await supabase
                .from('bookings')
                .select(`
                    *,
                    customers(name, phone),
                    services(name, color),
                    branches(name),
                    employees(name)
                `)
                .in('id', bookingIds);

            if (!bkError && bookingsData) {
                bookingsData.forEach(b => {
                    bookingsMap[b.id] = b;
                });
            }
        }

        // Fetch group counts for any bookings that have a group_booking_id
        const groupBookingIds = Object.values(bookingsMap)
            .map(b => b.group_booking_id)
            .filter(id => !!id);

        let groupCounts = {};
        if (groupBookingIds.length > 0) {
            const { data: groupBookings, error: grpError } = await supabase
                .from('bookings')
                .select('id, group_booking_id')
                .in('group_booking_id', groupBookingIds);

            if (!grpError && groupBookings) {
                groupBookings.forEach(b => {
                    if (b.group_booking_id) {
                        groupCounts[b.group_booking_id] = (groupCounts[b.group_booking_id] || 0) + 1;
                    }
                });
            }
        }

        // Ghép nối dữ liệu và gộp nhóm theo group_booking_id
        const merged = [];
        const seenGroups = new Set();

        for (const n of notifications) {
            const booking = bookingsMap[n.booking_id] || null;
            const groupBookingId = booking?.group_booking_id || null;

            if (groupBookingId) {
                if (seenGroups.has(groupBookingId)) {
                    continue; // Bỏ qua nếu đã có thông báo mới hơn trong nhóm
                }
                seenGroups.add(groupBookingId);

                const totalGuests = groupCounts[groupBookingId] || booking.num_guests || 1;
                const updatedBooking = {
                    ...booking,
                    num_guests: totalGuests
                };

                merged.push({
                    ...n,
                    bookings: updatedBooking
                });
            } else {
                merged.push({
                    ...n,
                    bookings: booking
                });
            }
        }

        res.json(merged);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/notifications/dashboard/:id/read
router.put('/dashboard/:id/read', async (req, res) => {
    try {
        const readVal = req.body && req.body.read !== undefined ? req.body.read : true;
        const { data, error } = await supabase
            .from('dashboard_notifications')
            .update({ read: readVal })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/notifications/dashboard/mark-all-read
router.post('/dashboard/mark-all-read', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('dashboard_notifications')
            .update({ read: true })
            .eq('read', false)
            .select();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/notifications/dashboard/:id
router.delete('/dashboard/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('dashboard_notifications')
            .delete()
            .eq('id', req.params.id)
            .select();

        if (error) throw error;
        res.json({ message: 'Thông báo đã được xóa thành công', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

