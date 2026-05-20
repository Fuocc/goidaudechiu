import { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiMapPin } from 'react-icons/fi';
import { getBranches, createBranch, updateBranch, deleteBranch } from '../api';

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
      console.error(err);
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

      <div style={{ display: 'flex', gap: 20 }}>
        {branches.map(branch => (
          <div key={branch.id} className="card" style={{ cursor: 'pointer' }} onClick={() => openEdit(branch)}>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: 8,
                    background: '#f7f7f7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', flexShrink: 0, border: '1px solid #eef0f2'
                  }}>
                    {branch.image_url ? (
                      <img src={branch.image_url} alt={branch.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <FiMapPin size={24} color="#888" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{branch.name}</div>
                    <div style={{ fontSize: 13, color: '#4b4b4b', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{branch.address || 'Chưa có địa chỉ'}</div>
                    <div style={{ fontSize: 13, color: '#afafaf', marginTop: 2 }}>{branch.phone || ''}</div>
                  </div>
                </div>
                <div className="actions-cell" style={{ flexShrink: 0, marginLeft: 8 }}>
                  <button className="btn-icon" onClick={() => openEdit(branch)}><FiEdit2 size={14} /></button>
                  <button className="btn-icon danger" onClick={() => handleDelete(branch.id)}><FiTrash2 size={14} /></button>
                </div>
              </div>

              {/* Weekly schedule list directly on card */}
              <div style={{ marginTop: 16, borderTop: '1px solid #f0f2f5', paddingTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9a9a9a', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.5px' }}>Lịch hoạt động:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 12, color: '#4b4b4b' }}>
                  {Object.entries(DAYS_VN).map(([dayKey, dayLabel]) => {
                    const dayData = branch.opening_hours?.[dayKey] || { isOpen: true, open: '09:00', close: '22:00' };
                    return (
                      <div key={dayKey} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#8c8c8c' }}>{dayLabel}:</span>
                        <span style={{ fontWeight: 500 }}>
                          {dayData.isOpen ? `${formatTime12hCompact(dayData.open)} - ${formatTime12hCompact(dayData.close)}` : <span style={{ color: '#d9534f', fontWeight: 500, marginRight: 'auto' }}>Đóng cửa</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {
        branches.length === 0 && (
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
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
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
                <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
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
                    <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Ảnh Thumbnail Chi Nhánh</label>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8, padding: '12px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                      <div style={{
                        width: 70, height: 70, borderRadius: 8,
                        background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden', border: '1px dashed #d9d9d9', flexShrink: 0
                      }}>
                        {form.image_url ? (
                          <img src={form.image_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 11, color: '#999', textAlign: 'center', padding: 4 }}>Chưa có ảnh</span>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <input type="file" accept="image/*" id="branch-img-upload" style={{ display: 'none' }} onChange={handleImageUpload} />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button type="button" className="btn btn-secondary" onClick={() => document.getElementById('branch-img-upload').click()} style={{ fontSize: 13, padding: '6px 12px', background: '#fff' }}>
                            Tải ảnh lên
                          </button>
                          {form.image_url && (
                            <button type="button" className="btn btn-secondary danger" onClick={() => setForm({ ...form, image_url: '' })} style={{ fontSize: 13, padding: '6px 12px', color: '#ff4d4f', border: '1px solid #ff4d4f', background: 'transparent' }}>
                              Xóa ảnh
                            </button>
                          )}
                        </div>
                        <p style={{ margin: '6px 0 0 0', fontSize: 11, color: '#8c8c8c' }}>Hỗ trợ ảnh JPG, PNG. Dung lượng tối đa 1MB.</p>
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
                  <div className="form-group" style={{ marginTop: 16 }}>
                    <label className="form-label" style={{ fontWeight: 700, marginBottom: 12 }}>Giờ mở cửa từng ngày trong tuần</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {Object.entries(DAYS_VN).map(([dayKey, dayLabel]) => {
                        const dayData = form.opening_hours[dayKey] || { isOpen: true, open: '08:00', close: '20:00' };
                        return (
                          <div key={dayKey} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            background: '#fafafa',
                            borderRadius: 8,
                            border: '1px solid #f0f0f0'
                          }}>
                            <span style={{ fontWeight: 600, width: 90 }}>{dayLabel}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, userSelect: 'none' }}>
                                <input type="checkbox" checked={dayData.isOpen} onChange={e => {
                                  const newHours = { ...form.opening_hours };
                                  newHours[dayKey] = { ...dayData, isOpen: e.target.checked };
                                  setForm({ ...form, opening_hours: newHours });
                                }} style={{ cursor: 'pointer' }} />
                                <span>Mở cửa</span>
                              </label>
                              {dayData.isOpen ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <input type="time" className="form-input" style={{ width: 100, padding: '4px 8px', fontSize: 13 }} value={dayData.open || '08:00'} onChange={e => {
                                    const newHours = { ...form.opening_hours };
                                    newHours[dayKey] = { ...dayData, open: e.target.value };
                                    setForm({ ...form, opening_hours: newHours });
                                  }} />
                                  <span style={{ fontSize: 12, color: '#888' }}>-</span>
                                  <input type="time" className="form-input" style={{ width: 100, padding: '4px 8px', fontSize: 13 }} value={dayData.close || '20:00'} onChange={e => {
                                    const newHours = { ...form.opening_hours };
                                    newHours[dayKey] = { ...dayData, close: e.target.value };
                                    setForm({ ...form, opening_hours: newHours });
                                  }} />
                                </div>
                              ) : (
                                <span style={{ color: '#d9534f', fontSize: 13, fontWeight: 600, width: 220, textAlign: 'right' }}>Đóng cửa</span>
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
