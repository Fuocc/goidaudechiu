const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET all employees (optionally filter by branch)
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('employees')
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

// GET employee by id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('*, branches(name)')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create employee
router.post('/', async (req, res) => {
  try {
    const { name, phone, branch_id, is_active } = req.body;
    const { data, error } = await supabase
      .from('employees')
      .insert([{ name, phone, branch_id, is_active: is_active !== false }])
      .select('*, branches(name)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update employee
router.put('/:id', async (req, res) => {
  try {
    const { name, phone, branch_id, is_active } = req.body;
    const { data, error } = await supabase
      .from('employees')
      .update({ name, phone, branch_id, is_active })
      .eq('id', req.params.id)
      .select('*, branches(name)')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE employee (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employees')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Employee deactivated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
