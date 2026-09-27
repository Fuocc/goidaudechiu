import { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/clerk-react';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { HiOutlineChevronLeft, HiOutlineChevronRight } from "react-icons/hi";
import { getCustomersPage, createCustomer, updateCustomer, deleteCustomer } from '../api';
import { toast } from 'react-toastify';
import { TableSkeleton, MobileCardSkeleton } from '../components/ui/Skeleton';
import { notifyError } from '../utils/notify';
import { useConfirm } from '../components/ConfirmDialog';
import { useModalA11y } from '../hooks/useModalA11y';

import noteIcon from '../assets/note-icon.svg';


const normalizeName = (name) => {
  if (!name) return '';
  let cleaned = name.trim();
  if (cleaned.toLowerCase().startsWith('c ')) {
    cleaned = 'Chị ' + cleaned.substring(2);
  } else if (cleaned.toLowerCase().startsWith('a ')) {
    cleaned = 'Anh ' + cleaned.substring(2);
  }
  return cleaned.split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

function Customers() {
  const confirmDialog = useConfirm();
  const [customers, setCustomers] = useState([]); // chỉ khách của trang hiện tại (phân trang ở server)
  const [total, setTotal] = useState(0);
  const [limited, setLimited] = useState(false); // kết quả tìm kiếm bị giới hạn 20 dòng
  const [search, setSearch] = useState('');       // nội dung ô tìm kiếm
  const [query, setQuery] = useState('');         // từ khóa đã debounce, dùng để gọi API
  const searchTimeoutRef = useRef(null);
  const loadSeqRef = useRef(0);
  const [loading, setLoading] = useState(true);

  // Xóa hồ sơ khách chỉ dành cho admin/dev (backend cũng chặn)
  const { user } = useUser();
  const canDelete = ['admin', 'dev'].includes(user?.publicMetadata?.role);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', habits: '' });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

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

  const loadCustomers = async () => {
    // Chỉ nhận kết quả của lần gọi mới nhất (gõ tìm / chuyển trang nhanh → response về lệch thứ tự)
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const result = await getCustomersPage({ page: currentPage, pageSize: itemsPerPage, search: query });
      if (seq !== loadSeqRef.current) return;
      const rows = result?.data || [];
      const totalCount = result?.total || 0;
      // Trang hiện tại không còn dữ liệu (VD vừa xóa khách cuối cùng của trang cuối) → lùi về trang cuối
      const lastPage = Math.max(1, Math.ceil(totalCount / itemsPerPage));
      if (rows.length === 0 && currentPage > lastPage) {
        setCurrentPage(lastPage);
        return;
      }
      setCustomers(rows);
      setTotal(totalCount);
      setLimited(!!result?.limited);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      notifyError(err, 'Không tải được danh sách khách hàng');
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [query, currentPage, itemsPerPage]);

  useEffect(() => () => clearTimeout(searchTimeoutRef.current), []);

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setQuery(val.trim());
      setCurrentPage(1); // từ khóa mới → về trang 1
    }, 400);
  };

  const openCreate = () => {
    setEditingCustomer(null);
    setForm({ name: '', phone: '', email: '', habits: '' });
    setModalOpen(true);
  };

  const openEdit = (customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || '',
      habits: customer.habits || ''
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const finalForm = {
        ...form,
        name: normalizeName(form.name)
      };
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, finalForm);
        notify(`Cập nhật khách hàng ${finalForm.name} thành công`);
      } else {
        await createCustomer(finalForm);
        notify(`Thêm khách hàng thành công`);
      }
      setModalOpen(false);
      loadCustomers();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirmDialog({ message: 'Bạn có chắc muốn xóa khách hàng này?', confirmText: 'Xóa', danger: true }))) return;
    try {
      await deleteCustomer(id);
      notify('Đã xóa thành công');
      if (editingCustomer?.id === id) setModalOpen(false); // xóa từ trong modal → đóng modal
      loadCustomers();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('vi-VN');
  };

  const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));
  const emptyTitle = query ? 'Không tìm thấy khách hàng phù hợp' : 'Chưa có khách hàng';
  const emptyText = query ? 'Thử tìm bằng tên khác hoặc số điện thoại' : 'Khách hàng sẽ được thêm tự động khi đặt lịch';

  const modalRef = useModalA11y(modalOpen, () => setModalOpen(false));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Khách hàng</h1>
          <p className="page-subtitle">Quản lý danh sách khách hàng</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <FiPlus /> Thêm khách hàng
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="search-bar" style={{ margin: 0, flex: 1, maxWidth: isMobile ? '100%' : 280 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 17.5C14.5899 17.5 17.5 14.5899 17.5 11C17.5 7.41015 14.5899 4.5 11 4.5C7.41015 4.5 4.5 7.41015 4.5 11C4.5 14.5899 7.41015 17.5 11 17.5Z" stroke="#afafaf"></path>
              <path d="M20.4 20.5L15.5 15.7" stroke="#afafaf"></path>
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Tìm kiếm theo tên hoặc SĐT..."
              value={search}
              onChange={handleSearch}
            />
          </div>
        </div>
        {limited && (
          <p style={{ margin: '0 16px 8px', fontSize: 12, color: '#78716C' }}>
            Chỉ hiển thị 20 kết quả phù hợp nhất — hãy gõ cụ thể hơn (VD thêm số điện thoại).
          </p>
        )}

        {loading ? (
          !isMobile ? (
            <TableSkeleton rows={itemsPerPage} cols={7} />
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
                  <th>ID</th>
                  <th>Tên</th>
                  <th>Số điện thoại</th>
                  <th>Email</th>
                  <th>Ghi chú</th>
                  <th>Ngày tạo</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan="7">
                      <div className="empty-state">
                        <h4>{emptyTitle}</h4>
                        <p>{emptyText}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  customers.map(c => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td className="data-table-name">{c.name}</td>
                      <td>{c.phone}</td>
                      <td>{c.email || '—'}</td>
                      <td><p style={{ width: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.habits || '—'}</p></td>
                      <td>{formatDate(c.created_at)}</td>
                      <td>
                        <div className="actions-cell">
                          <button className="btn-icon" aria-label="Sửa" onClick={() => openEdit(c)} title="Sửa">
                            <FiEdit2 size={14} />
                          </button>
                          {canDelete && (
                            <button className="btn-icon btn-danger" aria-label="Xóa" onClick={() => handleDelete(c.id)} title="Xóa">
                              <FiTrash2 size={14} />
                            </button>
                          )}
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
            {customers.length === 0 ? (
              <div className="empty-state">
                <h4>{emptyTitle}</h4>
                <p>{emptyText}</p>
              </div>
            ) : (
              customers.map(c => (
                <div key={c.id} className="mobile-card customer-card" onClick={() => openEdit(c)}>
                  <div className="mobile-card-row">
                    <span className="mobile-card-primary">{c.name}</span>
                    <div className="mobile-card-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn-icon" aria-label="Sửa" onClick={() => openEdit(c)}><FiEdit2 size={14} /></button>
                      {canDelete && (
                        <button className="btn-icon btn-danger" aria-label="Xóa" onClick={() => handleDelete(c.id)}><FiTrash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-secondary">{c.phone}</span>
                  </div>
                  <div className="customer-card-meta">
                    <span className="customer-card-id">{c.id}</span>
                    {c.habits ? <img src={noteIcon} alt="note icon" className='customer-card-note' /> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pagination Footer */}
        <div className="pagination-container">
          <div className="items-per-page">
            <span>Hiển thị</span>
            <select className="ipp-select" value={itemsPerPage} onChange={e => { setItemsPerPage(parseInt(e.target.value)); setCurrentPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>kết quả mỗi trang</span>
          </div>
          <div className="pagination-controls">
            <button className="page-btn" disabled={currentPage === 1 || loading} onClick={() => setCurrentPage(p => p - 1)}><HiOutlineChevronLeft /></button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i + 1}
                className={`page-btn${currentPage === i + 1 ? ' active' : ''}`}
                disabled={loading}
                onClick={() => setCurrentPage(i + 1)}
              >
                {i + 1}
              </button>
            )).slice(Math.max(0, currentPage - 3), Math.min(totalPages, currentPage + 2))}
            <button className="page-btn" disabled={currentPage >= totalPages || loading} onClick={() => setCurrentPage(p => p + 1)}><HiOutlineChevronRight /></button>
          </div>
        </div>
      </div>


      {/* Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" ref={modalRef} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingCustomer ? 'Sửa khách hàng' : 'Thêm khách hàng'}</h3>
              <button className="modal-close" aria-label="Đóng" onClick={() => setModalOpen(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 5L5 19" stroke="black" stroke-miterlimit="10"></path>
                  <path d="M5 5L19 19" stroke="black" stroke-miterlimit="10"></path>
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Họ và tên</label>
                  <input
                    type="text" className="form-input"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Số điện thoại</label>
                  <input
                    type="tel" className="form-input"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    type="email" className="form-input"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Ghi chú</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={form.habits}
                    onChange={e => setForm({ ...form, habits: e.target.value })}
                    style={{ resize: 'vertical' }}
                    placeholder="Ví dụ: thích massage mạnh, dị ứng tinh dầu, hay đặt buổi tối..."
                  />
                </div>
              </div>

              <div className="modal-footer">
                {editingCustomer && canDelete && (
                  <button type="button" className="btn btn-danger" onClick={() => handleDelete(editingCustomer.id)} style={{ marginRight: 'auto' }}>Xóa khách hàng</button>
                )}
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary">{editingCustomer ? 'Cập nhật' : 'Thêm'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Customers;