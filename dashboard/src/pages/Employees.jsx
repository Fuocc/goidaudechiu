import { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee, getBranches } from '../api';
import { toast } from 'react-toastify'


function Employees() {
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [filterBranch, setFilterBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', branch_id: '', is_active: true });

  // Responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const notify = (msg) => {
    toast.success(msg, {
      position: "bottom-right"
    });
  };

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [filterBranch]);

  const loadBranches = async () => {
    try {
      const data = await getBranches();
      setBranches(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const data = await getEmployees(filterBranch || undefined);
      setEmployees(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', branch_id: branches[0]?.id || '', is_active: true });
    setModalOpen(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({ name: emp.name, phone: emp.phone || '', branch_id: emp.branch_id || '', is_active: emp.is_active });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateEmployee(editing.id, form);
        notify(`Cập nhật nhân viên ${editing.name} thành công`);
      } else {
        await createEmployee(form);
        notify(`Thêm nhân viên thành công`);
      }
      setModalOpen(false);
      loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Bạn có chắc muốn vô hiệu hóa nhân viên này?')) return;
    try {
      await deleteEmployee(id);
      loadEmployees();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Nhân viên</h1>
          <p className="page-subtitle">Quản lý danh sách nhân viên</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <FiPlus /> Thêm nhân viên
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <select
            className="form-input max-w-240 p-8-12 fs-13"
            value={filterBranch}
            onChange={e => setFilterBranch(e.target.value)}
            style={isMobile ? { maxWidth: '100%' } : {}}
          >
            <option value="">Tất cả chi nhánh</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {!isMobile ? (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Số điện thoại</th>
                  <th>Chi nhánh</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan="5">
                      <div className="empty-state">
                        <h4>Chưa có nhân viên</h4>
                        <p>Thêm nhân viên để bắt đầu nhận lịch đặt</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  employees.map(emp => (
                    <tr key={emp.id}>
                      <td className="fw-600">{emp.name}</td>
                      <td>{emp.phone || '—'}</td>
                      <td>{emp.branches?.name || '—'}</td>
                      <td>
                        <span className={`badge ${emp.is_active ? 'badge-active' : 'badge-inactive'}`}>
                          {emp.is_active ? 'Hoạt động' : 'Nghỉ'}
                        </span>
                      </td>
                      <td>
                        <div className="actions-cell">
                          <button className="btn-icon" onClick={() => openEdit(emp)}><FiEdit2 size={14} /></button>
                          <button className="btn-icon btn-danger" onClick={() => handleDelete(emp.id)}><FiTrash2 size={14} /></button>
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
            {employees.length === 0 ? (
              <div className="empty-state">
                <h4>Chưa có nhân viên</h4>
                <p>Thêm nhân viên để bắt đầu nhận lịch đặt</p>
              </div>
            ) : (
              employees.map(emp => (
                <div key={emp.id} className="mobile-card employee-card" onClick={() => openEdit(emp)}>
                  <div className="employee-card-info">
                    <div className="employee-card-name">{emp.name}</div>
                    <div className="employee-card-branch">{emp.branches?.name || '—'} · {emp.phone || '—'}</div>
                  </div>
                  <span className={`badge ${emp.is_active ? 'badge-active' : 'badge-inactive'}`}>
                    {emp.is_active ? 'Hoạt động' : 'Nghỉ'}
                  </span>
                  <div className="mobile-card-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn-icon" onClick={() => openEdit(emp)}><FiEdit2 size={14} /></button>
                    <button className="btn-icon btn-danger" onClick={() => handleDelete(emp.id)}><FiTrash2 size={14} /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>


      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h3>
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
                  <label className="form-label">Tên nhân viên</label>
                  <input type="text" className="form-input" value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Số điện thoại</label>
                  <input type="tel" className="form-input" value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Chi nhánh</label>
                  <select className="form-select" value={form.branch_id}
                    onChange={e => setForm({ ...form, branch_id: e.target.value })} required>
                    <option value="">Chọn chi nhánh</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                {editing && (
                  <div className="form-group">
                    <label className="form-label d-flex align-items-center gap-8">
                      <input type="checkbox" checked={form.is_active}
                        onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                      Đang hoạt động
                    </label>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                {editing && (
                  <button type="button" className="btn btn-danger" onClick={() => handleDelete(editing.id)} style={{ marginRight: 'auto' }}>Xóa nhân viên</button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Cập nhật' : 'Thêm'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Employees;
