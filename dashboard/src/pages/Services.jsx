import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiEdit3, FiFileText, FiClock, FiDollarSign, FiFolder, FiChevronDown } from 'react-icons/fi';
import { getServices, createService, updateService, deleteService } from '../api';
import { toast } from 'react-toastify';
import { TableSkeleton, MobileCardSkeleton } from '../components/ui/Skeleton';
import { notifyError } from '../utils/notify';
import { useConfirm } from '../components/ConfirmDialog';
import { useModalA11y } from '../hooks/useModalA11y';
import { clickableProps } from '../utils/a11y';
import { SERVICE_CATEGORIES as CATEGORIES, SERVICE_COLORS as COLORS } from '../config/business';
import '../styles/services.css';

function Services() {
  const confirmDialog = useConfirm();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    duration_minutes: 0,
    price: 0,
    is_active: true,
    category: '',
    color: COLORS[0],
    shortcodes: []
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const colorPickerRef = useRef(null);
  const categoryRef = useRef(null);

  // Responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    loadServices();

    const handleClickOutside = (event) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target)) {
        setShowColorPicker(false);
      }
      if (categoryRef.current && !categoryRef.current.contains(event.target)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadServices = async () => {
    setLoading(true);
    try {
      const data = await getServices();
      setServices(data);
    } catch (err) {
      notifyError(err, 'Không tải được danh sách dịch vụ');
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (val) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val || 0);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      description: '',
      duration_minutes: 0,
      price: 0,
      is_active: true,
      category: '',
      color: COLORS[0],
      shortcodes: []
    });
    setModalOpen(true);
  };

  const openEdit = (svc) => {
    setEditing(svc);
    setForm({
      name: svc.name,
      description: svc.description || '',
      duration_minutes: svc.duration_minutes,
      price: svc.price,
      is_active: svc.is_active,
      category: svc.category || CATEGORIES[0],
      color: svc.color || COLORS[0],
      shortcodes: svc.shortcodes || []
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!form.name || form.price < 0 || !form.duration_minutes < 0) return;

    try {
      const payload = {
        ...form,
        price: parseInt(form.price),
        duration_minutes: parseInt(form.duration_minutes)
      };
      if (editing) {
        await updateService(editing.id, payload);
        toast.success(`Cập nhật ${editing.name} thành công`);
      } else {
        await createService(payload);
        toast.success('Thêm dịch vụ mới thành công');
      }
      setModalOpen(false);
      loadServices();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirmDialog({ message: 'Bạn có chắc muốn vô hiệu hóa dịch vụ này?', confirmText: 'Vô hiệu hóa', danger: true }))) return;
    try {
      await deleteService(id);
      setModalOpen(false);
      toast.success('Đã vô hiệu hóa dịch vụ');
      loadServices();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const isFormValid = form.name && form.price >= 0 && form.duration_minutes >= 0;

  // Esc: đóng bảng chọn màu / nhóm đang mở trước, rồi mới đóng modal
  const modalRef = useModalA11y(modalOpen, () => {
    if (showColorPicker) setShowColorPicker(false);
    else if (showCategoryDropdown) setShowCategoryDropdown(false);
    else setModalOpen(false);
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dịch vụ</h1>
          <p className="page-subtitle">Quản lý danh sách dịch vụ spa</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <FiPlus /> Thêm dịch vụ
        </button>
      </div>

      <div className="card">
        {loading ? (
          !isMobile ? (
            <TableSkeleton rows={5} cols={7} />
          ) : (
            <div className="mobile-card-list">
              {Array.from({ length: 3 }).map((_, i) => (
                <MobileCardSkeleton key={i} />
              ))}
            </div>
          )
        ) : !isMobile ? (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Màu</th>
                  <th>Tên dịch vụ</th>
                  <th>Nhóm</th>
                  <th>Thời lượng</th>
                  <th>Giá</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {services.length === 0 ? (
                  <tr>
                    <td colSpan="7">
                      <div className="empty-state">
                        <h4>Chưa có dịch vụ</h4>
                      </div>
                    </td>
                  </tr>
                ) : (
                  services.map(svc => (
                    <tr key={svc.id}>
                      <td>
                        <div className="service-color-dot" style={{ background: svc.color || '#ddd' }}></div>
                      </td>
                      <td className="service-text-bold">{svc.name}</td>
                      <td><span className="badge badge-info">{svc.category || null}</span></td>
                      <td>{svc.duration_minutes} phút</td>
                      <td className="service-text-bold">{formatPrice(svc.price)}</td>
                      <td>
                        <span className={`badge ${svc.is_active ? 'badge-active' : 'badge-inactive'}`}>
                          {svc.is_active ? 'Hoạt động' : 'Ẩn'}
                        </span>
                      </td>
                      <td>
                        <div className="actions-cell">
                          <button className="btn-icon" aria-label="Sửa" onClick={() => openEdit(svc)}><FiEdit2 size={14} /></button>
                          <button className="btn-icon btn-danger" aria-label="Xóa" onClick={() => handleDelete(svc.id)}><FiTrash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mobile-card-list">
            {services.length === 0 ? (
              <div className="empty-state">
                <h4>Chưa có dịch vụ</h4>
              </div>
            ) : (
              services.map(svc => (
                <div key={svc.id} className="mobile-card service-card" onClick={() => openEdit(svc)}>
                  <div className="mobile-card-row">
                    <div className="service-card-header">
                      <div className="service-card-color" style={{ background: svc.color || '#ddd' }}></div>
                      <span className="service-card-name">{svc.name}</span>
                    </div>
                    <div className="mobile-card-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn-icon" aria-label="Sửa" onClick={() => openEdit(svc)}><FiEdit2 size={14} /></button>
                      <button className="btn-icon btn-danger" aria-label="Xóa" onClick={() => handleDelete(svc.id)}><FiTrash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="service-card-details">
                    <span className="badge badge-info">{svc.category || '—'}</span>
                    <span className="service-card-detail-item"><FiClock size={12} /> {svc.duration_minutes}p</span>
                    <span className="service-card-detail-item service-text-bold">{formatPrice(svc.price)}</span>
                  </div>
                  {!svc.is_active && <span className="badge badge-inactive" style={{ alignSelf: 'flex-start' }}>Ẩn</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>


      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal service-modal" ref={modalRef} onClick={e => e.stopPropagation()}>
            <div className="modal-header service-modal-header">
              <h3 className="service-modal-title">{editing ? 'Sửa dịch vụ' : 'Thêm dịch vụ'}</h3>
              <button className="modal-close" aria-label="Đóng" onClick={() => setModalOpen(false)}>
                <FiPlus className="service-modal-close-icon" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body service-modal-body">
                {/* Tên dịch vụ */}
                <div className="service-form-group">
                  <FiEdit3 className="service-icon" size={20} />
                  <div className="service-input-wrapper">
                    <input
                      type="text"
                      className="service-input"
                      placeholder="Tên dịch vụ"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      required
                    />
                    <div
                      className="color-picker-trigger"
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      {...clickableProps(() => setShowColorPicker(!showColorPicker))}
                      aria-label="Chọn màu dịch vụ"
                    >
                      <div
                        className="color-indicator"
                        style={{ background: form.color }}

                      ></div>
                      <FiChevronDown color="#afafaf" />

                      {showColorPicker && (
                        <div className="color-picker-popover" ref={colorPickerRef}>
                          {COLORS.map(c => (
                            <div className="color-option-wrap" key={c}>
                              <div
                                className={`color-option ${form.color === c ? 'active' : ''}`}
                                style={{ background: c }}
                                onClick={() => {
                                  setForm({ ...form, color: c });
                                  setShowColorPicker(false);
                                }}
                                {...clickableProps(() => {
                                  setForm({ ...form, color: c });
                                  setShowColorPicker(false);
                                })}
                                aria-label={`Màu ${c}`}
                              ></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mô tả */}
                <div className="service-form-group">
                  <FiFileText className="service-icon" size={20} />
                  <div className="service-input-wrapper">
                    <input
                      type="text"
                      className="service-input"
                      placeholder="Thêm mô tả"
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                </div>

                {/* Thời lượng */}
                <div className="service-form-group">
                  <FiClock className="service-icon" size={20} />
                  <div className="service-input-wrapper">
                    <input
                      type="number"
                      className="service-input"
                      placeholder="Thời lượng (phút)"
                      value={form.duration_minutes || ''}
                      onChange={e => setForm({ ...form, duration_minutes: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Giá */}
                <div className="service-form-group">
                  <FiDollarSign className="service-icon" size={20} />
                  <div className="service-input-wrapper">
                    <input
                      type="number"
                      className="service-input"
                      placeholder="Giá (đ)"
                      value={form.price || ''}
                      onChange={e => setForm({ ...form, price: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Nhóm */}
                <div className="service-form-group" ref={categoryRef}>
                  <FiFolder className="service-icon" size={20} />
                  <div
                    className="service-input-wrapper service-input-clickable"
                    onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                    {...clickableProps(() => setShowCategoryDropdown(!showCategoryDropdown))}
                  >
                    <div className={`service-input ${form.category ? 'service-text-value' : 'service-text-placeholder'}`}>
                      {form.category || 'Nhóm Dịch Vụ'}
                    </div>
                    <FiChevronDown className="service-select-arrow" />

                    {showCategoryDropdown && (
                      <div className="category-dropdown">
                        {CATEGORIES.map(cat => (
                          <div
                            key={cat}
                            className={`category-item ${form.category === cat ? 'active' : ''}`}
                            onClick={() => {
                              setForm({ ...form, category: cat });
                              setShowCategoryDropdown(false);
                            }}
                            {...clickableProps(() => {
                              setForm({ ...form, category: cat });
                              setShowCategoryDropdown(false);
                            })}
                          >
                            {cat}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Shortcodes */}
                <div className="service-form-group">
                  <FiEdit3 className="service-icon" size={20} />
                  <div className="service-input-wrapper">
                    <div
                      className="service-input shortcodes-input-container"
                      onClick={e => e.currentTarget.querySelector('.shortcode-input')?.focus()}
                    >
                      {form.shortcodes.map((code, i) => (
                        <span key={i} className="shortcode-tag">
                          {code}
                          <button
                            type="button"
                            className="shortcode-tag-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              setForm({ ...form, shortcodes: form.shortcodes.filter((_, idx) => idx !== i) });
                            }}
                          >×</button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="shortcode-input"
                        placeholder={form.shortcodes.length === 0 ? "Thêm shortcode (Enter)" : ""}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            const val = e.target.value.trim().toLowerCase();
                            if (val && !form.shortcodes.includes(val)) {
                              setForm({ ...form, shortcodes: [...form.shortcodes, val] });
                            }
                            e.target.value = '';
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Toggle Hoạt động */}
                <div className="toggle-container">
                  <div
                    className={`toggle-switch ${!form.is_active ? 'active' : ''}`}
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                    {...clickableProps(() => setForm({ ...form, is_active: !form.is_active }))}
                    role="switch"
                    aria-checked={!form.is_active}
                    aria-label="Ẩn dịch vụ khỏi booking"
                  >
                    <div className="toggle-knob"></div>
                  </div>
                  <span className="toggle-label">Bật để ẩn khỏi booking</span>
                </div>
              </div>

              <div className="service-modal-footer">
                {editing && (
                  <button type="button" className="btn btn-danger" onClick={() => handleDelete(editing.id)} style={{ marginRight: 'auto', padding: '10px 16px', fontSize: '13px' }}>Xóa dịch vụ</button>
                )}
                <button
                  type="submit"
                  className={`btn-save ${isFormValid ? 'active' : ''}`}
                  disabled={!isFormValid}
                >
                  Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Services;
