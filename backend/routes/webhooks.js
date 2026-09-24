const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { assertSafeWebhookUrl, safeWebhookFetch } = require('../lib/safeUrl');

// Chỉ các sự kiện hệ thống thật sự phát ra
const WEBHOOK_EVENTS = ['booking.confirmed', 'booking.pending'];

// Kiểm tra dữ liệu webhook trước khi lưu (chặn URL nội bộ / http / sự kiện lạ)
async function validateWebhookInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
    if (!name) throw new Error('Vui lòng nhập tên webhook.');
    out.name = name;
  }
  if (!partial || body.url !== undefined) {
    out.url = await assertSafeWebhookUrl(body.url);
  }
  if (!partial || body.event !== undefined) {
    const event = body.event || 'booking.confirmed';
    if (!WEBHOOK_EVENTS.includes(event)) throw new Error('Loại sự kiện webhook không hợp lệ.');
    out.event = event;
  }
  if (body.is_active !== undefined) out.is_active = body.is_active !== false;
  return out;
}

/**
 * GET /api/webhooks
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks
 * Body: { name, url, event, is_active }
 */
router.post('/', async (req, res) => {
  try {
    let input;
    try {
      input = await validateWebhookInput(req.body || {});
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }
    const { data, error } = await supabase
      .from('webhooks')
      .insert([{ is_active: true, ...input }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/webhooks/:id
 */
router.put('/:id', async (req, res) => {
  try {
    let input;
    try {
      input = await validateWebhookInput(req.body || {}, { partial: true });
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }
    const { data, error } = await supabase
      .from('webhooks')
      .update(input)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/webhooks/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks/test/:id
 * Sends a test payload to the webhook URL
 */
router.post('/test/:id', async (req, res) => {
  try {
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const testPayload = {
      event: webhook.event,
      test: true,
      timestamp: new Date().toISOString(),
      data: {
        booking_id: 'test-123',
        customer_name: 'Test Customer',
        customer_phone: '0901234567',
        customer_email: 'test@example.com',
        service_name: 'Test Service',
        service_duration: 60,
        service_price: 400000,
        employee_name: 'Test Employee',
        bed_name: 'Giường 1',
        branch_name: 'Test Branch',
        booking_date: new Date().toISOString().split('T')[0],
        start_time: '10:00',
        end_time: '11:00',
        status: 'confirmed',
        total_price: 400000,
        num_guests: 1,
        notes: 'Test booking'
      }
    };

    let response;
    try {
      response = await safeWebhookFetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });
    } catch (fetchErr) {
      return res.status(400).json({ success: false, error: `Không gửi được webhook: ${fetchErr.message}` });
    }

    res.json({
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Test webhook sent successfully' : 'Webhook returned error'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
