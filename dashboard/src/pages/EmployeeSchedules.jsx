import { useState, useEffect, useMemo } from 'react';
import { FiChevronLeft, FiChevronRight, FiPlus } from 'react-icons/fi';
import { getEmployees, getEmployeeSchedules, createBulkSchedule, deleteEmployeeSchedule, getBranches } from '../api';
import { toast } from 'react-toastify'
import '../styles/schedules.css';

function getWeekDates(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd;
  });
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const formatTime12h = (t) => {
  if (!t) return '';
  const cleanTime = t.substring(0, 5);
  const [hStr, mStr] = cleanTime.split(':');
  const h = parseInt(hStr);
  if (isNaN(h)) return cleanTime;
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
};

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_FULL_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

function EmployeeSchedules() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [branches, setBranches] = useState([]);
  const [filterBranch, setFilterBranch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    id: null,
    employee_id: '', start_time: '09:00', end_time: '22:00',
    is_day_off: false, note: '', selectedDays: []
  });

  const [creatingDefault, setCreatingDefault] = useState(false);

  // Responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  const notify = (msg) => {
    toast.success(msg, {
      position: "bottom-right"
    });
  };

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, filterBranch]);

  const loadBranches = async () => {
    try {
      const data = await getBranches();
      setBranches(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async () => {
    try {
      const from = toDateStr(weekDates[0]);
      const to = toDateStr(weekDates[6]);
      const [empData, schedData] = await Promise.all([
        getEmployees(filterBranch || undefined),
        getEmployeeSchedules({ date_from: from, date_to: to })
      ]);
      setEmployees(empData.filter(e => e.is_active));
      setSchedules(schedData);
    } catch (err) {
      console.error(err);
    }
  };

  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); };
  const goNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); };

  const getSchedule = (empId, dateStr) => {
    return schedules.find(s => s.employee_id === empId && s.date === dateStr);
  };

  const openScheduleModal = (empId, dateStr, existingSched) => {
    if (existingSched) {
      setScheduleForm({
        id: existingSched.id,
        employee_id: existingSched.employee_id,
        start_time: existingSched.start_time?.substring(0, 5) || '09:00',
        end_time: existingSched.end_time?.substring(0, 5) || '22:00',
        is_day_off: existingSched.is_day_off,
        note: existingSched.note || '',
        selectedDays: [existingSched.date]
      });
    } else {
      setScheduleForm({
        id: null,
        employee_id: empId || employees[0]?.id || '',
        start_time: '09:00', end_time: '22:00',
        is_day_off: false, note: '',
        selectedDays: dateStr ? [dateStr] : []
      });
    }
    setModalOpen(true);
  };

  const toggleDay = (dateStr) => {
    setScheduleForm(f => ({
      ...f,
      selectedDays: f.selectedDays.includes(dateStr)
        ? f.selectedDays.filter(d => d !== dateStr)
        : [...f.selectedDays, dateStr]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (scheduleForm.selectedDays.length === 0) {
      alert('Vui lòng chọn ít nhất 1 ngày');
      return;
    }
    try {
      await createBulkSchedule({
        employee_id: scheduleForm.employee_id,
        dates: scheduleForm.selectedDays,
        start_time: scheduleForm.start_time,
        end_time: scheduleForm.end_time,
        is_day_off: scheduleForm.is_day_off,
        note: scheduleForm.note
      });
      setModalOpen(false);
      notify(`Thêm lịch làm thành công`);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSchedule = async (id) => {
    if (!confirm('Xóa lịch này?')) return;
    try {
      await deleteEmployeeSchedule(id);
      notify(`Xóa lịch làm thành công`);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // NEW: create default schedules 10:00-22:00 for ALL employees for the next 30 days
  const createDefaultSchedulesFor30Days = async () => {
    if (employees.length === 0) {
      alert('Chưa có nhân viên');
      return;
    }

    if (!confirm('Tạo lịch mặc định 09:00 AM - 10:00 PM cho TẤT CẢ nhân viên trong 30 ngày tới?')) return;

    setCreatingDefault(true);
    try {
      const dates = Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return toDateStr(d);
      });

      // Create schedules for each employee (bulk per employee)
      for (const emp of employees) {
        await createBulkSchedule({
          employee_id: emp.id,
          dates,
          start_time: '09:00',
          end_time: '22:00',
          is_day_off: false,
          note: null
        });
      }

      await loadData();
      notify('Đã tạo lịch làm việc cho 30 ngày tới');
    } catch (err) {
      alert(err.message);
    } finally {
      setCreatingDefault(false);
    }
  };

  const weekLabel = `${weekDates[0].getDate()}/${weekDates[0].getMonth() + 1} – ${weekDates[6].getDate()}/${weekDates[6].getMonth() + 1}/${weekDates[6].getFullYear()}`;
  const todayStr = toDateStr(new Date());

  return (
    <div className="schedules-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lịch nhân viên</h1>
          <p className="page-subtitle">Quản lý lịch làm việc, ca làm, ngày nghỉ</p>
        </div>
        <div className="d-flex gap-8" style={isMobile ? { flexDirection: 'column', width: '100%' } : {}}>
          <button className="btn btn-secondary" onClick={createDefaultSchedulesFor30Days} disabled={creatingDefault} style={isMobile ? { fontSize: 12 } : {}}>
            {creatingDefault ? 'Đang tạo...' : 'Tạo lịch mặc định (9:00AM - 10:00PM)'}
          </button>
          <button className="btn btn-primary" onClick={() => openScheduleModal()}>
            <FiPlus /> Xếp lịch
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar-left">
          <button className="btn btn-sm btn-secondary" onClick={goToday}>Hôm nay</button>
          <button className="btn btn-sm btn-ghost" onClick={goPrev}><FiChevronLeft /></button>
          <button className="btn btn-sm btn-ghost" onClick={goNext}><FiChevronRight /></button>
          <span className="cal-week-label">{weekLabel}</span>
        </div>
        <div className="cal-toolbar-right">
          <select className="form-select max-w-200 fs-13"
            value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
            style={isMobile ? { maxWidth: '100%' } : {}}
          >
            <option value="">Tất cả chi nhánh</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {/* Schedule Grid — Desktop: Table, Mobile: Cards */}
      {!isMobile ? (
        <div className="card overflow-auto">
          <table className="schedule-table">
            <thead>
              <tr>
                <th className="schedule-emp-col">Nhân viên</th>
                {weekDates.map(d => {
                  const ds = toDateStr(d);
                  const isToday = ds === todayStr;
                  return (
                    <th key={ds} className={`schedule-day-col${isToday ? ' today' : ''}`}>
                      <span className="cal-day-name">{DAY_NAMES[d.getDay()]}</span>
                      <span className={`cal-day-num${isToday ? ' today' : ''}`}>{d.getDate()}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-muted" style={{ padding: 40 }}>
                    Chưa có nhân viên
                  </td>
                </tr>
              ) : (
                employees.map(emp => (
                  <tr key={emp.id}>
                    <td className="schedule-emp-name">
                      <div className="fw-600 fs-13">{emp.name}</div>
                      <div className="fs-11 text-muted">{emp.branches?.name}</div>
                    </td>
                    {weekDates.map(d => {
                      const ds = toDateStr(d);
                      const sched = getSchedule(emp.id, ds);
                      const isToday = ds === todayStr;

                      return (
                        <td key={ds} className={`schedule-cell${isToday ? ' today' : ''}`}
                          onClick={() => openScheduleModal(emp.id, ds)}>
                          {sched ? (
                            <div className={`schedule-badge ${sched.is_day_off ? 'day-off' : 'working'}`}
                              onClick={(e) => { e.stopPropagation(); openScheduleModal(emp.id, ds, sched); }}>
                              {sched.is_day_off ? (
                                <span>Nghỉ</span>
                              ) : (
                                <span>{formatTime12h(sched.start_time)} - {formatTime12h(sched.end_time)}</span>
                              )}
                              {sched.note && <div className="schedule-note">{sched.note}</div>}
                            </div>
                          ) : (
                            <div className="schedule-empty">+</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Mobile: Employee cards with compact 7-day grid */
        <div className="schedule-mobile-list">
          {employees.length === 0 ? (
            <div className="empty-state">
              <h4>Chưa có nhân viên</h4>
            </div>
          ) : (
            employees.map(emp => (
              <div key={emp.id} className="schedule-mobile-emp">
                <div className="schedule-mobile-emp-header">
                  <div>
                    <div className="schedule-mobile-emp-name">{emp.name}</div>
                    <div className="schedule-mobile-emp-branch">{emp.branches?.name}</div>
                  </div>
                </div>
                <div className="schedule-mobile-days">
                  {weekDates.map(d => {
                    const ds = toDateStr(d);
                    const sched = getSchedule(emp.id, ds);
                    const isToday = ds === todayStr;

                    return (
                      <div
                        key={ds}
                        className={`schedule-mobile-day${isToday ? ' today' : ''}`}
                        onClick={() => openScheduleModal(emp.id, ds, sched || undefined)}
                      >
                        <span className="schedule-mobile-day-label">{DAY_NAMES[d.getDay()]}</span>
                        <span className={`schedule-mobile-day-num${isToday ? ' today' : ''}`}>{d.getDate()}</span>
                        {sched ? (
                          <span className={`schedule-mobile-day-status ${sched.is_day_off ? 'day-off' : 'working'}`}>
                            {sched.is_day_off ? 'Nghỉ' : `${formatTime12h(sched.start_time)} - ${formatTime12h(sched.end_time)}`}
                          </span>
                        ) : (
                          <span className="schedule-mobile-day-status empty">+</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}


      {/* Schedule Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Xếp lịch làm việc</h3>
              <button className="modal-close" onClick={() => setModalOpen(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 5L5 19" stroke="black" stroke-miterlimit="10"></path>
                  <path d="M5 5L19 19" stroke="black" stroke-miterlimit="10"></path>
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nhân viên</label>
                  <select className="form-select" value={scheduleForm.employee_id}
                    onChange={e => setScheduleForm({ ...scheduleForm, employee_id: e.target.value })} required>
                    <option value="">Chọn nhân viên</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.branches?.name})</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Chọn ngày (bấm để chọn/bỏ chọn)</label>
                  <div className="d-flex gap-6 flex-wrap">
                    {weekDates.map(d => {
                      const ds = toDateStr(d);
                      const selected = scheduleForm.selectedDays.includes(ds);
                      return (
                        <button key={ds} type="button"
                          className={`schedule-day-btn${selected ? ' selected' : ''}`}
                          onClick={() => toggleDay(ds)}>
                          {DAY_NAMES[d.getDay()]} {d.getDate()}/{d.getMonth() + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label d-flex align-items-center gap-8">
                    <input type="checkbox" checked={scheduleForm.is_day_off}
                      onChange={e => setScheduleForm({ ...scheduleForm, is_day_off: e.target.checked })} />
                    Ngày nghỉ
                  </label>
                </div>

                {!scheduleForm.is_day_off && (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Giờ bắt đầu</label>
                      <input type="time" className="form-input" value={scheduleForm.start_time}
                        onChange={e => setScheduleForm({ ...scheduleForm, start_time: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Giờ kết thúc</label>
                      <input type="time" className="form-input" value={scheduleForm.end_time}
                        onChange={e => setScheduleForm({ ...scheduleForm, end_time: e.target.value })} />
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Ghi chú</label>
                  <input type="text" className="form-input" value={scheduleForm.note}
                    onChange={e => setScheduleForm({ ...scheduleForm, note: e.target.value })}
                    placeholder="VD: Ca sáng, Học thêm..." />
                </div>
              </div>
              <div className="modal-footer">
                {scheduleForm.id && (
                  <button type="button" className="btn btn-danger" onClick={() => handleDeleteSchedule(scheduleForm.id)}>Xóa lịch làm</button>
                )}
                <button type="submit" className="btn btn-primary">Lưu lịch</button>
              </div>
            </form>
          </div>
        </div >
      )
      }
    </div >
  );
}

export default EmployeeSchedules;