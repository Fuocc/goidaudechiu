const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

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
    const { name, url, event, is_active } = req.body;
    const { data, error } = await supabase
      .from('webhooks')
      .insert([{ name, url, event, is_active: is_active !== false }])
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
    const { name, url, event, is_active } = req.body;
    const { data, error } = await supabase
      .from('webhooks')
      .update({ name, url, event, is_active })
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

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

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
