const supabase = require('./supabaseClient');

async function generateForNext30Days() {
  try {
    const { data: employees } = await supabase.from('employees').select('id').eq('is_active', true);
    if (!employees || employees.length === 0) {
      return;
    }

    const dates = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    for (const emp of employees) {
      const records = dates.map(date => ({
        employee_id: emp.id,
        date,
        start_time: '09:00',
        end_time: '22:00',
        is_day_off: false,
        note: null
      }));
      await supabase.from('employee_schedules').upsert(records, { onConflict: 'employee_id,date', ignoreDuplicates: true });
    }
  } catch (err) {
    console.error('❌ Lỗi khi tự động tạo lịch nhân viên:', err);
  }
}

function startAutoScheduler() {
  generateForNext30Days();
  setInterval(generateForNext30Days, 24 * 60 * 60 * 1000);
}

module.exports = { startAutoScheduler };
