const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;
const SLOT_STEP_MINUTES = 15;

/**
 * GET /api/availability
 * Query params: branch_id, service_id, date (YYYY-MM-DD), num_guests
 *
 * NOTE: endpoint này giữ lại cho dashboard đang dùng.
 */
router.get('/', async (req, res) => {
  try {
    const { branch_id, service_id, date, num_guests } = req.query;

    if (!branch_id || !service_id || !date) {
      return res.status(400).json({ error: 'branch_id, service_id, and date are required' });
    }

    const guestCount = parseInt(num_guests) || 1;

    // 1. Get service duration
    const { data: service, error: serviceErr } = await supabase
      .from('services')
      .select('duration_minutes')
      .eq('id', service_id)
      .single();

    if (serviceErr || !service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const duration = service.duration_minutes;

    const slots = await getAvailabilityForBranch({
      branchId: branch_id,
      date,
      guestCount,
      durationMinutes: duration
    });

    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/availability/merged
 * Query params:
 *  - date (YYYY-MM-DD) [required]
 *  - num_guests [optional, default 1]
 *  - service_id OR duration_minutes (for Skip)
 *
 * Returns merged slots across all branches:
 *  [
 *    { start_time, end_time, available, branches:[branchId...] }
 *  ]
 */
router.get('/merged', async (req, res) => {
  try {
    const { date, num_guests, service_id, duration_minutes } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }

    const guestCount = parseInt(num_guests) || 1;

    let duration = null;

    if (service_id) {
      const { data: service, error: serviceErr } = await supabase
        .from('services')
        .select('duration_minutes')
        .eq('id', service_id)
        .single();

      if (serviceErr || !service) {
        return res.status(404).json({ error: 'Service not found' });
      }
      duration = service.duration_minutes;
    } else {
      duration = parseInt(duration_minutes) || 60;
    }

    const { data: branches, error: brErr } = await supabase
      .from('branches')
      .select('id, name')
      .order('name');

    if (brErr) throw brErr;

    // Load availability for each branch (but allow optimization: skip branches
    // that can never satisfy guestCount even with 0 bookings)
    const perBranch = [];

    for (const br of branches) {
      const summary = await getAvailabilityForBranch({
        branchId: br.id,
        date,
        guestCount,
        durationMinutes: duration
      });

      // Optimization per your request:
      // if a branch has total employees/beds < guestCount -> all slots unavailable anyway.
      // We avoid "pulling other branch" by not including it in merge.
      if ((summary.total_employees || 0) < guestCount || (summary.total_beds || 0) < guestCount) {
        continue;
      }

      perBranch.push({ branchId: br.id, slots: summary.slots || [] });
    }

    // Merge by start_time
    const map = new Map(); // start_time -> {start_time,end_time,available,branches:[]}

    for (const br of perBranch) {
      for (const s of br.slots) {
        const key = s.start_time;
        if (!map.has(key)) {
          map.set(key, {
            start_time: s.start_time,
            end_time: s.end_time,
            available: false,
            branches: []
          });
        }

        if (s.available) {
          const cur = map.get(key);
          cur.available = true;
          cur.branches.push(br.branchId);
        }
      }
    }

    // Sort keys by time
    const merged = Array.from(map.values()).sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    res.json({
      slots: merged,
      branches_used: perBranch.map(x => x.branchId),
      service_duration: duration
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Core calculator for a single branch.
 * Integrates employee_schedules with rules:
 * - Default schedule is 10:00-22:00 (if no record exists for employee & date)
 * - If schedule record exists:
 *    - is_day_off=true => employee unavailable all day
 *    - else available only within [start_time, end_time)
 * - If schedule record is deleted => treated as unavailable (per your convention)
 *   => meaning: ONLY employees with schedule record are considered working.
 *
 * IMPORTANT: Because you said "click xóa = xóa record schedule" and you want that employee becomes unavailable,
 * we interpret: schedule record exists => working; missing record => NOT working.
 * That matches: default "you must create schedule for everyone first".
 *
 * If you want "missing record = default working", tell me and I'll flip this logic.
 */
async function getAvailabilityForBranch({ branchId, date, guestCount, durationMinutes }) {
  // 1) Service duration
  const duration = durationMinutes;

  // 1.1) Load branch opening hours
  let openHour = OPEN_HOUR;
  let closeHour = CLOSE_HOUR;
  let isClosed = false;

  try {
    const { data: branch } = await supabase
      .from('branches')
      .select('opening_hours')
      .eq('id', branchId)
      .single();

    if (branch && branch.opening_hours) {
      const [year, month, day] = date.split('-').map(Number);
      const dObj = new Date(year, month - 1, day);
      const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = daysOfWeek[dObj.getDay()];
      const daySchedule = branch.opening_hours[dayName];

      if (daySchedule) {
        if (daySchedule.isOpen === false || daySchedule.closed === true) {
          isClosed = true;
        } else {
          if (daySchedule.open) {
            const [h] = daySchedule.open.split(':').map(Number);
            openHour = h;
          }
          if (daySchedule.close) {
            const [h] = daySchedule.close.split(':').map(Number);
            closeHour = h;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error fetching branch opening hours:', err);
  }

  if (isClosed) {
    return {
      slots: [],
      total_employees: 0,
      total_beds: 0,
      service_duration: duration
    };
  }

  // 2) Load employees active
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id')
    .eq('branch_id', branchId)
    .eq('is_active', true);

  if (empErr) throw empErr;

  // 2.1) Load schedules for these employees on date
  const employeeIds = employees.map(e => e.id);

  let schedules = [];
  if (employeeIds.length > 0) {
    const { data: schedData, error: schedErr } = await supabase
      .from('employee_schedules')
      .select('employee_id, start_time, end_time, is_day_off')
      .in('employee_id', employeeIds)
      .eq('date', date);

    if (schedErr) throw schedErr;
    schedules = schedData || [];
  }

  // Interpret "xóa record => unavailable": only employees with schedule record (and not day off) are working
  const scheduleByEmp = new Map();
  for (const s of schedules) scheduleByEmp.set(s.employee_id, s);

  const workingEmployees = employees.filter(e => {
    const s = scheduleByEmp.get(e.id);
    if (!s) return false; // deleted/missing => unavailable
    if (s.is_day_off) return false;
    // must have start/end
    return !!s.start_time && !!s.end_time;
  });

  // 3) Load beds active
  const { data: beds, error: bedErr } = await supabase
    .from('beds')
    .select('id')
    .eq('branch_id', branchId)
    .eq('is_active', true);

  if (bedErr) throw bedErr;

  const totalEmployees = workingEmployees.length;
  const totalBeds = beds.length;

  // 4) Load bookings that day (non-cancelled)
  const { data: bookings, error: bookErr } = await supabase
    .from('bookings')
    .select('employee_id, bed_id, start_time, end_time')
    .eq('branch_id', branchId)
    .eq('booking_date', date)
    .neq('status', 'cancelled');

  if (bookErr) throw bookErr;

  // 4.1) Load buffer time from settings
  const { data: settingsData } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'buffer_time')
    .single();
  const bufferTime = settingsData ? parseInt(settingsData.value) : 15;

  // 5) Generate slots
  const slots = [];

  for (let h = openHour; h < closeHour; h++) {
    for (let m = 0; m < 60; m += SLOT_STEP_MINUTES) {
      const startMinutes = h * 60 + m;
      const endMinutes = startMinutes + duration;

      if (endMinutes > closeHour * 60) continue;

      const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const endH = Math.floor(endMinutes / 60);
      const endM = endMinutes % 60;
      const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

      // Busy employees/beds by booking overlap
      const busyEmployees = new Set();
      const busyBeds = new Set();

      for (const booking of bookings) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time) + bufferTime;

        // Check if proposed slot [startMinutes, startMinutes + duration] overlaps [bStart, bEnd]
        if (startMinutes < bEnd && bStart < (startMinutes + duration)) {
          if (booking.employee_id) busyEmployees.add(booking.employee_id);
          if (booking.bed_id) busyBeds.add(booking.bed_id);
        }
      }

      // Also remove employees not working at this time window (schedule)
      const availableWorkingEmployees = workingEmployees.filter(e => {
        if (busyEmployees.has(e.id)) return false;
        const s = scheduleByEmp.get(e.id);
        if (!s) return false;
        const sStart = timeToMinutes(String(s.start_time).substring(0, 5));
        const sEnd = timeToMinutes(String(s.end_time).substring(0, 5));
        // Proposed slot must fit within working hours
        return startMinutes >= sStart && (startMinutes + duration) <= sEnd;
      });

      const availableEmployees = availableWorkingEmployees.length;
      const availableBeds = totalBeds - busyBeds.size;

      const disabled = availableEmployees < guestCount || availableBeds < guestCount;

      // Actual end time (without buffer) for display
      const actualEndTotal = startMinutes + duration;
      const actualEndH = Math.floor(actualEndTotal / 60);
      const actualEndM = actualEndTotal % 60;
      const actualEndTime = `${String(actualEndH).padStart(2, '0')}:${String(actualEndM).padStart(2, '0')}`;

      slots.push({
        start_time: startTime,
        end_time: actualEndTime,
        available: !disabled,
        available_employees: availableEmployees,
        available_beds: availableBeds
      });
    }
  }

  return {
    slots,
    total_employees: totalEmployees,
    total_beds: totalBeds,
    service_duration: duration
  };
}

/**
 * Helper: convert "HH:MM" or "HH:MM:SS" to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

module.exports = router;