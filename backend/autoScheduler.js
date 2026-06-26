const supabase = require('./supabaseClient');

/**
 * Tự động tạo lịch làm việc (09:00 - 22:00) cho tất cả nhân viên
 * cho 30 ngày tiếp theo.
 * Logic sử dụng UPSERT nên không sợ bị trùng lặp nếu chạy nhiều lần.
 */
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
      // Thêm ignoreDuplicates: true để KHÔNG ghi đè lên các ngày mà Admin đã sửa bằng tay (ví dụ xin nghỉ)
      await supabase.from('employee_schedules').upsert(records, { onConflict: 'employee_id,date', ignoreDuplicates: true });
    }
  } catch (err) {
    console.error('❌ Lỗi khi tự động tạo lịch nhân viên:', err);
  }
}

function startAutoScheduler() {
  // Chạy ngay 1 lần lúc server vừa khởi động
  generateForNext30Days();

  // Sau đó thiết lập cứ đúng 24 tiếng (24 * 60 * 60 * 1000 ms) sẽ chạy lại 1 lần
  setInterval(generateForNext30Days, 24 * 60 * 60 * 1000);
}

module.exports = { startAutoScheduler };
