const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

/**
 * GET /api/employee-schedules
 * Query: branch_id, employee_id, date_from, date_to
 */
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('employee_schedules')
      .select('*, employees(name, branch_id, branches(name))')
      .order('date')
      .order('start_time');

    if (req.query.employee_id) {
      query = query.eq('employee_id', req.query.employee_id);
    }
    if (req.query.branch_id) {
      query = query.eq('employees.branch_id', req.query.branch_id);
    }
    if (req.query.date_from) {
      query = query.gte('date', req.query.date_from);
    }
    if (req.query.date_to) {
      query = query.lte('date', req.query.date_to);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/employee-schedules
 * Body: { employee_id, date, start_time, end_time, is_day_off, note }
 */
router.post('/', async (req, res) => {
  try {
    const { employee_id, date, start_time, end_time, is_day_off, note } = req.body;
    const { data, error } = await supabase
      .from('employee_schedules')
      .insert([{
        employee_id,
        date,
        start_time: is_day_off ? null : start_time,
        end_time: is_day_off ? null : end_time,
        is_day_off: is_day_off || false,
        note: note || null
      }])
      .select('*, employees(name)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/employee-schedules/bulk
 * Body: { employee_id, dates: ['2026-04-20', ...], start_time, end_time, is_day_off }
 * Creates schedules for multiple dates at once
 */
router.post('/bulk', async (req, res) => {
  try {
    const { employee_id, dates, start_time, end_time, is_day_off, note } = req.body;

    const records = dates.map(date => ({
      employee_id,
      date,
      start_time: is_day_off ? null : start_time,
      end_time: is_day_off ? null : end_time,
      is_day_off: is_day_off || false,
      note: note || null
    }));

    const { data, error } = await supabase
      .from('employee_schedules')
      .upsert(records, { onConflict: 'employee_id,date' })
      .select('*, employees(name)');

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/employee-schedules/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { start_time, end_time, is_day_off, note } = req.body;
    const { data, error } = await supabase
      .from('employee_schedules')
      .update({
        start_time: is_day_off ? null : start_time,
        end_time: is_day_off ? null : end_time,
        is_day_off,
        note
      })
      .eq('id', req.params.id)
      .select('*, employees(name)')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/employee-schedules/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('employee_schedules')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
