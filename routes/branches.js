const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET all branches
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET branch by id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create branch
router.post('/', async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    const { data, error } = await supabase
      .from('branches')
      .insert([{ name, address, phone }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update branch
router.put('/:id', async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    const { data, error } = await supabase
      .from('branches')
      .update({ name, address, phone })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE branch
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Branch deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
