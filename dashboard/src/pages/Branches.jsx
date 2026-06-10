import { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiMapPin } from 'react-icons/fi';
import { getBranches, createBranch, updateBranch, deleteBranch } from '../api';
import { CardSkeleton } from '../components/ui/Skeleton';
import '../styles/branches.css';

const DEFAULT_OPENING_HOURS = {
  Monday: { isOpen: true, open: '08:00', close: '20:00' },
  Tuesday: { isOpen: true, open: '08:00', close: '20:00' },
  Wednesday: { isOpen: true, open: '08:00', close: '20:00' },
  Thursday: { isOpen: true, open: '08:00', close: '20:00' },
  Friday: { isOpen: true, open: '08:00', close: '20:00' },
  Saturday: { isOpen: true, open: '08:00', close: '20:00' },
  Sunday: { isOpen: true, open: '08:00', close: '20:00' }
};

const DAYS_VN = {
  Monday: 'Thứ 2',
  Tuesday: 'Thứ 3',
  Wednesday: 'Thứ 4',
  Thursday: 'Thứ 5',
  Friday: 'Thứ 6',
  Saturday: 'Thứ 7',
  Sunday: 'Chủ Nhật'
};

function formatTime12hCompact(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mPart = m > 0 ? `:${String(m).padStart(2, '0')}` : '';
  return `${h12}${mPart} ${ampm}`;
}

function Branches() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', phone: '', image_url: '', google_map_url: '', opening_hours: DEFAULT_OPENING_HOURS });

  useEffect(() => {
    loadBranches();
  }, []);

  const loadBranches = async () => {
    setLoading(true);
    try {
      const data = await getBranches();
      setBranches(data);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      alert("Dung lượng ảnh phải dưới 1MB!");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setForm(prev => ({ ...prev, image_url: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', address: '', phone: '', image_url: '', google_map_url: '', opening_hours: DEFAULT_OPENING_HOURS });
    setModalOpen(true);
  };

  const openEdit = (branch) => {
    setEditing(branch);
    setForm({
      name: branch.name,
      address: branch.address || '',
      phone: branch.phone || '',
      image_url: branch.image_url || '',
      google_map_url: branch.google_map_url || '',
      opening_hours: branch.opening_hours || DEFAULT_OPENING_HOURS
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        await updateBranch(editing.id, form);
      } else {
        await createBranch(form);
      }
      setModalOpen(false);
      loadBranches();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Bạn có chắc muốn xóa chi nhánh này? Điều này có thể ảnh hưởng đến nhân viên và giường thuộc chi nhánh.')) return;
    try {
      await deleteBranch(id);
      loadBranches();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Chi nhánh</h1>
          <p className="page-subtitle">Quản lý các chi nhánh spa</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <FiPlus /> Thêm chi nhánh
        </button>
      </div>

      <div className="branch-list">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))
        ) : (
          branches.map(branch => (
            <div key={branch.id} className="card branch-card" onClick={() => openEdit(branch)}>
              <div className="card-body">
                <div className="branch-card-header">
                  <div className="branch-info-wrapper">
                    <div className="branch-avatar">
                      {branch.image_url ? (
                        <img src={branch.image_url} alt={branch.name} />
                      ) : (
                        <FiMapPin size={24} color="#888" />
                      )}
                    </div>
                    <div className="branch-details">
                      <div className="branch-name">{branch.name}</div>
                      <div className="branch-address">{branch.address || 'Chưa có địa chỉ'}</div>
                      <div className="branch-phone">{branch.phone || ''}</div>
                    </div>
                  </div>
                  <div className="actions-cell branch-actions">
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); openEdit(branch); }}><FiEdit2 size={14} /></button>
                    <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); handleDelete(branch.id); }}><FiTrash2 size={14} /></button>
                  </div>
                </div>

                {/* Weekly schedule list directly on card */}
                <div className="branch-schedule-wrapper">
                  <div className="branch-schedule-title">Lịch hoạt động:</div>
                  <div className="branch-schedule-grid">
                    {Object.entries(DAYS_VN).map(([dayKey, dayLabel]) => {
                      const dayData = branch.opening_hours?.[dayKey] || { isOpen: true, open: '09:00', close: '22:00' };
                      return (
                        <div key={dayKey} className="branch-schedule-day">
                          <span className="branch-schedule-day-name">{dayLabel}:</span>
                          <span className="branch-schedule-day-time">
                            {dayData.isOpen ? `${formatTime12hCompact(dayData.open)} - ${formatTime12hCompact(dayData.close)}` : <span className="branch-schedule-closed">Đóng cửa</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {
        !loading && branches.length === 0 && (
          <div className="card">
            <div className="empty-state">
              <h4>Chưa có chi nhánh</h4>
              <p>Thêm chi nhánh đầu tiên để bắt đầu</p>
            </div>
          </div>
        )
      }

      {
        modalOpen && (
          <div className="modal-overlay" onClick={() => setModalOpen(false)}>
            <div className="modal branch-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{editing ? 'Sửa chi nhánh' : 'Thêm chi nhánh'}</h3>
                <button className="modal-close" onClick={() => setModalOpen(false)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 5L5 19" stroke="black" stroke-miterlimit="10"></path>
                    <path d="M5 5L19 19" stroke="black" stroke-miterlimit="10"></path>
                  </svg>
                </button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body branch-modal-body">
                  <div className="form-group">
                    <label className="form-label">Tên chi nhánh</label>
                    <input type="text" className="form-input" value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Địa chỉ</label>
                    <input type="text" className="form-input" value={form.address}
                      onChange={e => setForm({ ...form, address: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Số điện thoại</label>
                    <input type="tel" className="form-input" value={form.phone}
                      onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label branch-image-label">Ảnh Thumbnail Chi Nhánh</label>
                    <div className="branch-image-upload-wrapper">
                      <div className="branch-image-preview">
                        {form.image_url ? (
                          <img src={form.image_url} alt="Preview" />
                        ) : (
                          <span className="branch-image-placeholder">Chưa có ảnh</span>
                        )}
                      </div>
                      <div className="branch-image-actions">
                        <input type="file" accept="image/*" id="branch-img-upload" style={{ display: 'none' }} onChange={handleImageUpload} />
                        <div className="branch-image-btn-group">
                          <button type="button" className="btn btn-secondary branch-image-btn" onClick={() => document.getElementById('branch-img-upload').click()}>
                            Tải ảnh lên
                          </button>
                          {form.image_url && (
                            <button type="button" className="btn btn-secondary branch-image-btn-delete" onClick={() => setForm({ ...form, image_url: '' })}>
                              Xóa ảnh
                            </button>
                          )}
                        </div>
                        <p className="branch-image-hint">Hỗ trợ ảnh JPG, PNG. Dung lượng tối đa 1MB.</p>
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Đường dẫn Google Map (URL)</label>
                    <input type="url" className="form-input" value={form.google_map_url || ''}
                      onChange={e => setForm({ ...form, google_map_url: e.target.value })}
                      placeholder="https://maps.app.goo.gl/..." />
                  </div>

                  {/* Schedule Editor */}
                  <div className="form-group branch-schedule-edit-group">
                    <label className="form-label branch-schedule-edit-label">Giờ mở cửa từng ngày trong tuần</label>
                    <div className="branch-schedule-edit-list">
                      {Object.entries(DAYS_VN).map(([dayKey, dayLabel]) => {
                        const dayData = form.opening_hours[dayKey] || { isOpen: true, open: '08:00', close: '20:00' };
                        return (
                          <div key={dayKey} className="branch-schedule-edit-item">
                            <span className="branch-schedule-edit-day">{dayLabel}</span>
                            <div className="branch-schedule-edit-controls">
                              <label className="branch-schedule-edit-checkbox">
                                <input type="checkbox" checked={dayData.isOpen} onChange={e => {
                                  const newHours = { ...form.opening_hours };
                                  newHours[dayKey] = { ...dayData, isOpen: e.target.checked };
                                  setForm({ ...form, opening_hours: newHours });
                                }} style={{ cursor: 'pointer' }} />
                                <span>Mở cửa</span>
                              </label>
                              {dayData.isOpen ? (
                                <div className="branch-schedule-edit-times">
                                  <input type="time" className="form-input branch-schedule-time-input" value={dayData.open || '08:00'} onChange={e => {
                                    const newHours = { ...form.opening_hours };
                                    newHours[dayKey] = { ...dayData, open: e.target.value };
                                    setForm({ ...form, opening_hours: newHours });
                                  }} />
                                  <span className="branch-schedule-time-separator">-</span>
                                  <input type="time" className="form-input branch-schedule-time-input" value={dayData.close || '20:00'} onChange={e => {
                                    const newHours = { ...form.opening_hours };
                                    newHours[dayKey] = { ...dayData, close: e.target.value };
                                    setForm({ ...form, opening_hours: newHours });
                                  }} />
                                </div>
                              ) : (
                                <span className="branch-schedule-edit-closed">Đóng cửa</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Hủy</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Đang cập nhật...' : (editing ? 'Cập nhật' : 'Thêm')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }
    </div >
  );
}

export default Branches;
