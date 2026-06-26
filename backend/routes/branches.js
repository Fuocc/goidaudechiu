const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET all branches
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select('*, beds(id)')
      .order('name');

    if (error) throw error;
    
    const branches = data.map(b => {
      const bedCount = b.beds ? b.beds.length : 0;
      delete b.beds;
      return { ...b, bed_count: bedCount };
    });
    
    res.json(branches);
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
    const { name, address, phone, image_url, opening_hours, google_map_url, bed_count } = req.body;
    const { data, error } = await supabase
      .from('branches')
      .insert([{ name, address, phone, image_url, opening_hours, google_map_url }])
      .select()
      .single();

    if (error) throw error;
    
    if (data && data.id) {
      const count = parseInt(bed_count);
      const finalCount = isNaN(count) ? 10 : count;
      if (finalCount > 0) {
        const defaultBeds = Array.from({ length: finalCount }, (_, i) => ({
          name: `Giường ${i + 1}`,
          branch_id: data.id,
          is_active: true
        }));
        await supabase.from('beds').insert(defaultBeds);
      }
    }

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update branch
router.put('/:id', async (req, res) => {
  try {
    const { name, address, phone, image_url, opening_hours, google_map_url, bed_count } = req.body;
    const { data, error } = await supabase
      .from('branches')
      .update({ name, address, phone, image_url, opening_hours, google_map_url })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    
    if (bed_count !== undefined) {
      const count = parseInt(bed_count) || 0;
      const { data: currentBeds } = await supabase.from('beds').select('id, name, is_active').eq('branch_id', req.params.id);
      const currentCount = currentBeds ? currentBeds.length : 0;
      
      if (count > currentCount) {
        const newBeds = Array.from({ length: count - currentCount }, (_, i) => ({
          name: `Giường ${currentCount + i + 1}`,
          branch_id: req.params.id,
          is_active: true
        }));
        await supabase.from('beds').insert(newBeds);
      } else if (count < currentCount) {
        const bedsToDelete = currentBeds.slice(count).map(b => b.id);
        await supabase.from('beds').delete().in('id', bedsToDelete);
      }
    }
    
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
