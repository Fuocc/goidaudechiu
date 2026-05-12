const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// Get all settings
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*');
    
    if (error) {
      // If table doesn't exist, we might get an error. 
      // In that case, return empty object or default
      console.error('Error fetching settings:', error);
      return res.json({});
    }
    
    const settings = data.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a setting
router.post('/', async (req, res) => {
  try {
    const { key, value } = req.body;
    
    const { data, error } = await supabase
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key' });
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
