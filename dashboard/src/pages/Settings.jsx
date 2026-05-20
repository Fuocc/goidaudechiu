import { useState, useEffect } from 'react';
import { FiSave, FiClock, FiSettings, FiZap, FiPlus, FiEdit2, FiTrash2, FiPlay, FiList } from 'react-icons/fi';
import {
  getSettings, updateSetting,
  getWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook,
  getBranches, getEmployees
} from '../api';
import { toast } from 'react-toastify';
import '../styles/webhooks.css';

function Settings() {
  const [activeTab, setActiveTab] = useState('general'); // 'general', 'webhooks', or 'tour'

  // General Settings State
  const [settings, setSettings] = useState({
    buffer_time: 15
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Webhooks State
  const [webhooks, setWebhooks] = useState([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState(null);
  const [webhookForm, setWebhookForm] = useState({ name: '', url: '', event: 'booking.confirmed', is_active: true });
  const [testResult, setTestResult] = useState(null);

  // Tour State
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [tourStaff, setTourStaff] = useState([]);
  const [initialTourOrder, setInitialTourOrder] = useState([]);
  const [tourLoading, setTourLoading] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (activeTab === 'webhooks') {
      loadWebhooks();
    }
    if (activeTab === 'tour') {
      loadTourData();
    }
  }, [activeTab]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      if (data && Object.keys(data).length > 0) {
        setSettings(prev => ({
          ...prev,
          ...data
        }));
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSetting = async (key, value) => {
    setSaving(true);
    try {
      await updateSetting({ key, value });
      setSettings(prev => ({ ...prev, [key]: value }));
      toast.success('Cập nhật cài đặt thành công!');
    } catch (err) {
      toast.error('Lỗi khi lưu cài đặt: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Webhook Functions
  const loadWebhooks = async () => {
    setWebhooksLoading(true);
    try {
      const data = await getWebhooks();
      setWebhooks(data);
    } catch (err) {
      console.error(err);
    } finally {
      setWebhooksLoading(false);
    }
  };

  const openCreateWebhook = () => {
    setEditingWebhook(null);
    setWebhookForm({ name: '', url: '', event: 'booking.confirmed', is_active: true });
    setWebhookModalOpen(true);
  };

  const openEditWebhook = (webhook) => {
    setEditingWebhook(webhook);
    setWebhookForm({ name: webhook.name, url: webhook.url, event: webhook.event, is_active: webhook.is_active });
    setWebhookModalOpen(true);
  };

  const handleWebhookSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingWebhook) {
        await updateWebhook(editingWebhook.id, webhookForm);
        toast.success('Cập nhật webhook thành công!');
      } else {
        await createWebhook(webhookForm);
        toast.success('Thêm webhook thành công!');
      }
      setWebhookModalOpen(false);
      loadWebhooks();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteWebhook = async (id) => {
    if (!confirm('Xóa webhook này?')) return;
    try {
      await deleteWebhook(id);
      toast.success('Xóa webhook thành công!');
      loadWebhooks();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleTestWebhook = async (id) => {
    setTestResult(null);
    try {
      const result = await testWebhook(id);
      setTestResult({ id, ...result });
      setTimeout(() => setTestResult(null), 5000);
    } catch (err) {
      setTestResult({ id, success: false, message: err.message });
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const handleToggleWebhook = async (webhook) => {
    try {
      await updateWebhook(webhook.id, { ...webhook, is_active: !webhook.is_active });
      loadWebhooks();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Tour Functions
  const loadTourData = async () => {
    setTourLoading(true);
    try {
      const bData = await getBranches();
      setBranches(bData);
      if (bData.length > 0 && !selectedBranch) {
        setSelectedBranch(bData[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTourLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBranch && activeTab === 'tour') {
      loadBranchStaff(selectedBranch);
    }
  }, [selectedBranch, activeTab]);

  const loadBranchStaff = async (branchId) => {
    setTourLoading(true);
    try {
      const staff = await getEmployees(branchId);
      const activeStaff = staff.filter(e => e.is_active);

      // Try to load existing order from settings
      const tourKey = `tour_order_${branchId}`;
      const savedOrder = settings[tourKey]; // settings are already loaded

      if (savedOrder && Array.isArray(savedOrder)) {
        // Sort active staff by saved order
        const sorted = [...activeStaff].sort((a, b) => {
          const idxA = savedOrder.indexOf(a.id);
          const idxB = savedOrder.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
        setTourStaff(sorted);
        setInitialTourOrder(sorted.map(s => s.id));
      } else {
        setTourStaff(activeStaff);
        setInitialTourOrder(activeStaff.map(s => s.id));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTourLoading(false);
    }
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newStaff = [...tourStaff];
    const item = newStaff.splice(draggedIndex, 1)[0];
    newStaff.splice(index, 0, item);

    setTourStaff(newStaff);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const saveTourOrder = async () => {
    if (!selectedBranch) return;
    const tourKey = `tour_order_${selectedBranch}`;
    const orderIds = tourStaff.map(s => s.id);
    await handleSaveSetting(tourKey, orderIds);
    setInitialTourOrder(orderIds);
  };

  const isTourModified = JSON.stringify(tourStaff.map(s => s.id)) !== JSON.stringify(initialTourOrder);

  if (loading && activeTab === 'general') {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '200px' }}>
        <p className="text-muted">Đang tải cài đặt...</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cài đặt hệ thống</h1>
          <p className="page-subtitle">Quản lý các cấu hình chung của hệ thống</p>
        </div>
      </div>

      <div className="detail-tabs mb-24">
        <button
          className={`detail-tab-btn tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          Cài đặt chung
        </button>
        <button
          className={`detail-tab-btn tab-btn ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
        >
          Webhooks
        </button>
        <button
          className={`detail-tab-btn tab-btn ${activeTab === 'tour' ? 'active' : ''}`}
          onClick={() => setActiveTab('tour')}
        >
          Xếp Tour
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'general' && (
          <div className="settings-grid max-w-800 gap-24" style={{ display: 'grid' }}>
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'start', alignItems: 'center', gap: '12px' }}>
                <FiClock size={20} color="#e67e22" />
                <h3 className="card-title">Thời gian chờ (Buffer Time)</h3>
              </div>
              <div className="card-body">
                <p className="fs-14 text-muted mb-16">
                  Khoảng thời gian nghỉ giữa các ca làm việc (phút). Thời gian này sẽ được cộng thêm vào tổng thời gian dịch vụ khi tính toán lịch trống cho khách hàng đặt online.
                </p>
                <div className="d-flex align-items-center gap-12">
                  <input
                    type="number"
                    className="form-input max-w-120"
                    value={settings.buffer_time}
                    onChange={e => setSettings({ ...settings, buffer_time: parseInt(e.target.value) || 0 })}
                    min="0"
                    step="5"
                  />
                  <span className="fs-14 text-muted">phút</span>
                  <button
                    className="btn btn-primary ml-auto"
                    onClick={() => handleSaveSetting('buffer_time', settings.buffer_time)}
                    disabled={saving}
                  >
                    <FiSave className="mr-8" />
                    {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'start', alignItems: 'center', gap: '12px' }}>
                <FiSettings size={20} color="#2563eb" />
                <h3 className="card-title">Cấu hình khác</h3>
              </div>
              <div className="card-body">
                <p className="fs-14 text-muted">
                  Các cài đặt nâng cao khác sẽ được cập nhật thêm tại đây.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'webhooks' && (
          <div className="webhooks-container">
            <div className="d-flex justify-content-between align-items-center mb-24">
              <div className="card-body d-flex gap-16 align-items-start p-0">
                <div className="bg-light-warning d-flex align-items-center justify-content-center flex-shrink-0 rounded-8" style={{ width: 40, height: 40 }}>
                  <FiZap size={20} className="text-warning" />
                </div>
                <div>
                  <div className="fw-600 mb-4">Tích hợp Zapier / Automation</div>
                  <div className="fs-13 text-dark-muted" style={{ lineHeight: 1.6 }}>
                    Gửi dữ liệu lịch hẹn tự động đến các ứng dụng khác thông qua Webhook URL.
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" onClick={openCreateWebhook}>
                <FiPlus className="mr-8" /> Thêm Webhook
              </button>
            </div>

            <div className="card mb-24">
              <div className="card-header">
                <h3 className="card-title">Danh sách Webhooks</h3>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tên</th>
                      <th>URL</th>
                      <th>Sự kiện</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooksLoading ? (
                      <tr><td colSpan="5" className="text-center p-24">Đang tải...</td></tr>
                    ) : webhooks.length === 0 ? (
                      <tr>
                        <td colSpan="5">
                          <div className="empty-state">
                            <FiZap size={32} />
                            <h4>Chưa có webhook</h4>
                            <p>Thêm webhook đầu tiên để tích hợp Zapier</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      webhooks.map(w => (
                        <tr key={w.id}>
                          <td className="fw-600">{w.name}</td>
                          <td>
                            <code className="fs-12 bg-light-muted rounded-4" style={{ padding: '2px 6px', wordBreak: 'break-all' }}>
                              {w.url}
                            </code>
                          </td>
                          <td><span className="badge badge-confirmed">{w.event}</span></td>
                          <td>
                            <label className="d-flex align-items-center gap-8 cursor-pointer">
                              <div className={`toggle-switch${w.is_active ? ' active' : ''}`}
                                onClick={() => handleToggleWebhook(w)}>
                                <div className="toggle-knob"></div>
                              </div>
                              <span className={`fs-12 ${w.is_active ? 'text-success' : 'text-muted'}`}>
                                {w.is_active ? 'Bật' : 'Tắt'}
                              </span>
                            </label>
                          </td>
                          <td>
                            <div className="actions-cell">
                              <button className="btn-icon" onClick={() => handleTestWebhook(w.id)} title="Test">
                                <FiPlay size={14} />
                              </button>
                              <button className="btn-icon" onClick={() => openEditWebhook(w)} title="Sửa">
                                <FiEdit2 size={14} />
                              </button>
                              <button className="btn-icon btn-danger" onClick={() => handleDeleteWebhook(w.id)} title="Xóa">
                                <FiTrash2 size={14} />
                              </button>
                            </div>
                            {testResult?.id === w.id && (
                              <div className={`fs-12 mt-6 ${testResult.success ? 'text-success' : 'text-danger'}`}>
                                {testResult.success ? '✅ Test thành công' : `❌ ${testResult.message}`}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Payload mẫu</h3>
              </div>
              <div className="card-body">
                <pre className="fs-12 bg-light-muted p-16 rounded-8 overflow-auto" style={{ lineHeight: 1.5 }}>
                  {`{
  "event": "booking.confirmed",
  "timestamp": "2026-04-18T10:00:00.000Z",
  "data": {
    "booking_id": "uuid-here",
    "customer_name": "Nguyễn Văn A",
    "customer_phone": "0901234567",
    ...
  }
}`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tour' && (
          <div className="tour-settings-container">
            <div className="d-flex justify-content-between align-items-center mb-24">
              <div>
                <h3 className="card-title">Thứ tự ưu tiên nhân viên (Tour)</h3>
                <p className="fs-14 text-muted mt-4">Kéo thả để sắp xếp thứ tự ưu tiên nhận khách trong ngày.</p>
              </div>
              <div className="d-flex gap-12 align-items-center">
                <select
                  className="form-select max-w-200"
                  value={selectedBranch}
                  onChange={e => setSelectedBranch(e.target.value)}
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button
                  className={`btn btn-primary ${saving || !isTourModified ? 'opacity-50' : null}`}
                  onClick={saveTourOrder}
                  disabled={saving || !isTourModified}
                >
                  <FiSave className="mr-8" />
                  {saving ? 'Đang lưu...' : 'Lưu thứ tự'}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-body p-0">
                {tourLoading ? (
                  <div className="text-center p-40 text-muted p-16">Đang tải danh sách nhân viên...</div>
                ) : tourStaff.length === 0 ? (
                  <div className="text-center p-40 text-muted">Không có nhân viên nào tại chi nhánh này.</div>
                ) : (
                  <div className="tour-list">
                    {tourStaff.map((s, idx) => (
                      <div
                        key={s.id}
                        className={`tour-item ${draggedIndex === idx ? 'dragging' : ''}`}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="tour-item-order">{idx + 1}</div>
                        <div className="tour-item-avatar">
                          {s.name.trim().split(' ').at(-1)[0]}
                        </div>
                        <div className="tour-item-info">
                          <div className="fw-600">{s.name}</div>
                          <div className="fs-12 text-muted">{s.phone || 'Chưa có SĐT'}</div>
                        </div>
                        <div className="tour-item-handle">
                          <FiList size={18} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Webhook Modal */}
      {webhookModalOpen && (
        <div className="modal-overlay" onClick={() => setWebhookModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingWebhook ? 'Sửa Webhook' : 'Thêm Webhook'}</h3>
              <button className="modal-close" onClick={() => setWebhookModalOpen(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 5L5 19" stroke="black" stroke-miterlimit="10"></path>
                  <path d="M5 5L19 19" stroke="black" stroke-miterlimit="10"></path>
                </svg>
              </button>
            </div>
            <form onSubmit={handleWebhookSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tên</label>
                  <input type="text" className="form-input" value={webhookForm.name}
                    onChange={e => setWebhookForm({ ...webhookForm, name: e.target.value })}
                    placeholder="VD: Zapier Nhắc lịch SMS" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Webhook URL</label>
                  <input type="url" className="form-input" value={webhookForm.url}
                    onChange={e => setWebhookForm({ ...webhookForm, url: e.target.value })}
                    placeholder="https://hooks.zapier.com/hooks/catch/..." required />
                </div>
                <div className="form-group">
                  <label className="form-label">Sự kiện trigger</label>
                  <select className="form-select" value={webhookForm.event}
                    onChange={e => setWebhookForm({ ...webhookForm, event: e.target.value })}>
                    <option value="booking.confirmed">Booking xác nhận</option>
                    <option value="booking.completed">Booking hoàn thành</option>
                    <option value="booking.cancelled">Booking hủy</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary">{editingWebhook ? 'Cập nhật' : 'Thêm'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
