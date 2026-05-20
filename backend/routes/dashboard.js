const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

/**
 * GET /api/dashboard/stats
 * Returns dashboard statistics: revenue, booking counts, etc.
 * Query params: branch_id (optional), period ('today', 'week', 'month', 'year')
 */
router.get('/stats', async (req, res) => {
  try {
    const { branch_id, period } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate;
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    // Total bookings in period
    let bookingQuery = supabase
      .from('bookings')
      .select('id, total_price, status, booking_date')
      .gte('booking_date', startDateStr)
      .neq('status', 'cancelled');

    if (branch_id) {
      bookingQuery = bookingQuery.eq('branch_id', branch_id);
    }

    const { data: bookings, error: bookErr } = await bookingQuery;
    if (bookErr) throw bookErr;

    // Calculate stats
    const totalBookings = bookings.length;
    const completedBookings = bookings.filter(b => b.status === 'completed');
    const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.total_price || 0), 0);
    const todayBookings = bookings.filter(b => b.booking_date === todayStr).length;

    // Total customers
    const { count: totalCustomers, error: custErr } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true });

    if (custErr) throw custErr;

    // Revenue by day (for chart)
    const revenueByDay = {};
    for (const booking of completedBookings) {
      const day = booking.booking_date;
      revenueByDay[day] = (revenueByDay[day] || 0) + (booking.total_price || 0);
    }

    // Bookings by status
    const statusCounts = {};
    for (const booking of bookings) {
      statusCounts[booking.status] = (statusCounts[booking.status] || 0) + 1;
    }

    res.json({
      total_bookings: totalBookings,
      today_bookings: todayBookings,
      total_revenue: totalRevenue,
      total_customers: totalCustomers || 0,
      revenue_by_day: revenueByDay,
      bookings_by_status: statusCounts,
      completed_bookings: completedBookings.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/revenue-chart
 * Returns daily revenue for the last N days
 * Query params: days (default 30), branch_id (optional)
 */
router.get('/revenue-chart', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const { branch_id } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    let query = supabase
      .from('bookings')
      .select('booking_date, total_price')
      .gte('booking_date', startDateStr)
      .eq('status', 'completed')
      .order('booking_date');

    if (branch_id) {
      query = query.eq('branch_id', branch_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Group by date
    const chartData = {};
    for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      chartData[dateStr] = 0;
    }

    for (const booking of data) {
      chartData[booking.booking_date] = (chartData[booking.booking_date] || 0) + booking.total_price;
    }

    const result = Object.entries(chartData).map(([date, revenue]) => ({
      date,
      revenue
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/top-services
 * Returns most booked services
 */
router.get('/top-services', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('service_id, services(name, price)')
      .eq('status', 'completed');

    if (error) throw error;

    const serviceCounts = {};
    for (const booking of data) {
      const id = booking.service_id;
      if (!serviceCounts[id]) {
        serviceCounts[id] = {
          name: booking.services?.name || 'Unknown',
          price: booking.services?.price || 0,
          count: 0,
          revenue: 0
        };
      }
      serviceCounts[id].count++;
      serviceCounts[id].revenue += booking.services?.price || 0;
    }

    const result = Object.values(serviceCounts).sort((a, b) => b.count - a.count);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
