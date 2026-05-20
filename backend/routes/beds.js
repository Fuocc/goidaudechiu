const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET all beds (optionally filter by branch)
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('beds')
      .select('*, branches(name)')
      .order('name');

    if (req.query.branch_id) {
      query = query.eq('branch_id', req.query.branch_id);
    }
    if (req.query.active_only === 'true') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create bed
router.post('/', async (req, res) => {
  try {
    const { name, branch_id, is_active } = req.body;
    const { data, error } = await supabase
      .from('beds')
      .insert([{ name, branch_id, is_active: is_active !== false }])
      .select('*, branches(name)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update bed
router.put('/:id', async (req, res) => {
  try {
    const { name, branch_id, is_active } = req.body;
    const { data, error } = await supabase
      .from('beds')
      .update({ name, branch_id, is_active })
      .eq('id', req.params.id)
      .select('*, branches(name)')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE bed (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('beds')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Bed deactivated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
