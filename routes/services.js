const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET all services
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all services (including inactive) for admin
router.get('/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET service by id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create service
router.post('/', async (req, res) => {
  try {
    const { name, description, duration_minutes, price, is_active, category, color } = req.body;
    let payload = { name, description, duration_minutes, price, is_active: is_active !== false };
    
    let result = await supabase
      .from('services')
      .insert([{ ...payload, category, color }])
      .select()
      .single();

    // Fallback if category/color columns do not exist
    if (result.error && result.error.message && result.error.message.includes('column')) {
      result = await supabase
        .from('services')
        .insert([payload])
        .select()
        .single();
    }

    if (result.error) throw result.error;
    res.status(201).json(result.data);
  } catch (err) {
    console.error('Create service error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT update service
router.put('/:id', async (req, res) => {
  try {
    const { name, description, duration_minutes, price, is_active, category, color } = req.body;
    let payload = { name, description, duration_minutes, price, is_active };

    let result = await supabase
      .from('services')
      .update({ ...payload, category, color })
      .eq('id', req.params.id)
      .select()
      .single();

    // Fallback if category/color columns do not exist
    if (result.error && result.error.message && result.error.message.includes('column')) {
      result = await supabase
        .from('services')
        .update(payload)
        .eq('id', req.params.id)
        .select()
        .single();
    }

    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) {
    console.error('Update service error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE service (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('services')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Service deactivated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
