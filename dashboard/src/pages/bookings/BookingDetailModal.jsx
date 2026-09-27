import { getInitial } from '../../utils/format';
import { clickableProps } from '../../utils/a11y';
import { DatePicker, parseDate } from '@chakra-ui/react';
import { FiPlus, FiMoreVertical, FiX } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { formatPrice } from './helpers';
import TimePickerInput from '../../components/TimePickerInput';
import userIcon from '../../assets/user-icon.svg';
import shopIcon from '../../assets/shop-icon.svg';
import clockIcon from '../../assets/clock-icon.svg';
import noteIcon from '../../assets/note-icon.svg';

// Modal chi tiết / sửa lịch hẹn (tab Lịch + tab Khách, menu Nhân bản / Hủy lịch)
// Component trình bày: state + handler vẫn nằm ở Bookings.jsx, truyền vào qua props.
export default function BookingDetailModal({
  branches,
  calendarRef,
  detailCustomerView,
  detailEdit,
  detailModal,
  detailModalRef,
  detailSaving,
  detailTab,
  handleCancel,
  handleDateChange,
  handleDismissWarning,
  handleDuplicate,
  handleGenericSearch,
  handleSaveDetail,
  handleSelectSuggestion,
  handleTimeChange,
  isDetailModified,
  moreMenuRef,
  searchSuggestions,
  services,
  setDetailCustomerView,
  setDetailEdit,
  setDetailModal,
  setDetailTab,
  setSearchSuggestions,
  setShowCalendar,
  setShowDetailMore,
  showCalendar,
  showDetailMore
}) {
  return (
    <>
      {detailModal && (
        <div className="modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="modal modal-viewing max-w-480" ref={detailModalRef} onClick={e => e.stopPropagation()}>
            <div className="modal-header modal-header-clean">
              <h3 className="modal-title-lg">Chi tiết</h3>
              <button className="modal-close" aria-label="Đóng" onClick={() => setDetailModal(null)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 5L5 19" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path d="M5 5L19 19" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>

            <div className="detail-tabs">
              <button
                className={`detail-tab-btn tab-btn ${detailTab === 'schedule' ? 'active' : ''}`}
                onClick={() => setDetailTab('schedule')}
              >
                Lịch
              </button>
              <button
                className={`detail-tab-btn tab-btn ${detailTab === 'customer' ? 'active' : ''}`}
                onClick={() => setDetailTab('customer')}
              >
                Khách
              </button>
            </div>

            <div className="modal-body modal-body-clean">
              {/* Anti-spam warning banner */}
              {detailEdit.internal_note && (
                <div className="anti-spam-alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <span className="anti-spam-alert-text" style={{ flex: 1 }}>{detailEdit.internal_note}</span>
                  <button
                    className="anti-spam-dismiss-btn"
                    onClick={(e) => handleDismissWarning(e, detailModal)}
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: 'none',
                      color: '#92400e',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '4px',
                      borderRadius: '50%',
                      transition: 'all 0.2s',
                      width: '24px',
                      height: '24px',
                      flexShrink: 0
                    }}
                    title="Tắt cảnh báo"
                  >
                    <FiX size={14} />
                  </button>
                </div>
              )}
              {detailTab === 'schedule' ? (
                <div className="detail-view">
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <div className="service-icon-dot sm" style={{ background: services.find(s => s.id === detailEdit.service_id)?.color || '#0d8a3f' }}></div>
                    </div>
                    <div className="booking-row-content">
                      <div className="pos-relative">
                        <input
                          type="text"
                          className={`form-input form-input-clean ${!detailEdit.service_id && detailEdit.service_search ? 'error' : ''}`}
                          value={detailEdit.service_search}
                          onChange={e => {
                            handleGenericSearch('service', e.target.value, true);
                            if (detailEdit.service_id) setDetailEdit(prev => ({ ...prev, service_id: '' }));
                          }}
                          onFocus={() => handleGenericSearch('service', detailEdit.service_search, true)}
                          onBlur={() => setTimeout(() => setSearchSuggestions({ type: null, data: [], loading: false }), 200)}
                          placeholder="Chọn Dịch Vụ"
                          autoComplete="off"
                        />
                        {searchSuggestions.type === 'service' && searchSuggestions.loading && (
                          <div className="spinner-icon spinner-icon-right" />
                        )}
                        {searchSuggestions.type === 'service' && searchSuggestions.data.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {searchSuggestions.data.map((s, idx) => {
                              if (s.isHeader) {
                                return (
                                  <div key={`header-${idx}`} className="autocomplete-header">
                                    {s.name}
                                  </div>
                                );
                              }
                              return (
                                <div key={s.id} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion('service', s, true)}>
                                  <div className="service-icon-dot sm" style={{ background: s.color || '#F8F3EC' }}></div>
                                  <div className="customer-info">
                                    <div className="autocomplete-name">{s.name}</div>
                                    <div className="customer-phone">{formatPrice(s.price)}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <img src={clockIcon} alt="time" className="icon-w24" />
                    </div>
                    <div className="booking-row-content row-content-between">
                      <div className="booking-date-container">
                        <input
                          type="text"
                          className="form-input form-input-clean cursor-pointer"
                          readOnly
                          value={detailEdit.booking_date ? new Date(detailEdit.booking_date).toLocaleDateString('vi-VN') : '--/--/----'}
                          onClick={() => setShowCalendar(!showCalendar)}
                        />
                        {showCalendar && (
                          <div
                            ref={calendarRef}
                            className="calendar-popover"
                          >
                            <DatePicker.Root
                              selectionMode="single"
                              hideOutsideDays
                              inline
                              width="fit-content"
                              value={detailEdit.booking_date ? [parseDate(detailEdit.booking_date)] : []}
                              onValueChange={(details) => {
                                if (details.value[0]) {
                                  const d = details.value[0];
                                  const dateStr = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

                                  const selectedDate = new Date(dateStr);
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);

                                  if (selectedDate < today) {
                                    toast.warn('Không thể chọn ngày trong quá khứ');
                                    return;
                                  }

                                  handleDateChange(dateStr);
                                  setShowCalendar(false);
                                }
                              }}
                            >
                              <DatePicker.Content unstyled>
                                <DatePicker.View view="day">
                                  <DatePicker.Header />
                                  <DatePicker.DayTable />
                                </DatePicker.View>
                                <DatePicker.View view="month">
                                  <DatePicker.Header />
                                  <DatePicker.MonthTable />
                                </DatePicker.View>
                                <DatePicker.View view="year">
                                  <DatePicker.Header />
                                  <DatePicker.YearTable />
                                </DatePicker.View>
                              </DatePicker.Content>
                            </DatePicker.Root>
                          </div>
                        )}
                      </div>
                      <div className="time-picker-group">
                        <TimePickerInput
                          value={detailEdit.start_time}
                          onChange={val => handleTimeChange('start_time', val)}
                        />
                        <span className="time-separator-text">—</span>
                        <TimePickerInput
                          value={detailEdit.end_time}
                          onChange={val => handleTimeChange('end_time', val)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      {detailCustomerView === 'selected' || detailCustomerView === 'creating' ? (
                        <div className="customer-avatar customer-avatar-selected">
                          {getInitial(detailEdit.customer_name, 'C', { upper: true })}
                        </div>
                      ) : (
                        <img src={userIcon} alt="user" />
                      )}
                    </div>
                    <div className="booking-row-content">
                      {detailCustomerView === 'selected' && (
                        <div className="customer-info py-0 cursor-pointer" onClick={() => setDetailCustomerView('searching')} {...clickableProps(() => setDetailCustomerView('searching'))}>
                          <div className="booking-row-title">{detailEdit.customer_name}</div>
                          <div className="customer-phone">{detailEdit.customer_phone}</div>
                        </div>
                      )}

                      {detailCustomerView === 'searching' && (
                        <div className="pos-relative">
                          <input
                            type="text"
                            className="form-input form-input-search"
                            autoFocus
                            value={detailEdit.customer_search}
                            onChange={e => handleGenericSearch('customer', e.target.value, true)}
                            onFocus={() => handleGenericSearch('customer', detailEdit.customer_search, true)}
                            onBlur={() => setTimeout(() => {
                              if (detailCustomerView !== 'selected' && detailCustomerView !== 'creating' && !detailEdit.customer_search) {
                                setDetailCustomerView('selected');
                              }
                              setSearchSuggestions({ type: null, data: [], loading: false });
                            }, 200)}
                            placeholder="Tên khách hàng hoặc SĐT..."
                            autoComplete="off"
                          />
                          {searchSuggestions.type === 'customer' && searchSuggestions.loading && (
                            <div className="spinner-icon spinner-icon-right" />
                          )}
                          {searchSuggestions.type === 'customer' && (
                            <div className="autocomplete-dropdown">
                              {searchSuggestions.data.map(c => (
                                <div key={c.id} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion('customer', c, true)}>
                                  <div className="customer-avatar">{getInitial(c.name)}</div>
                                  <div className="customer-info">
                                    <div className="autocomplete-name">{c.name}</div>
                                    <div className="customer-phone">{c.phone}</div>
                                  </div>
                                </div>
                              ))}
                              <div className="autocomplete-footer" onMouseDown={() => handleSelectSuggestion('customer', 'new', true)}>
                                <FiPlus /> Tạo Khách Mới
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {detailCustomerView === 'creating' && (
                        <div className="new-customer-fields">
                          <input className="form-input form-input-clean" placeholder="Tên khách"
                            value={detailEdit.customer_name} onChange={e => setDetailEdit(f => ({ ...f, customer_name: e.target.value }))} />
                          <input className="form-input phone-input-sm" placeholder="Nhập SĐT"
                            value={detailEdit.customer_phone} onChange={e => setDetailEdit(f => ({ ...f, customer_phone: e.target.value }))} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <img src={shopIcon} alt="branch" className="icon-w24" />
                    </div>
                    <div className="booking-row-content">
                      <select
                        className="form-select form-input-clean"
                        value={detailEdit.branch_id}
                        onChange={e => {
                          const newBranchId = e.target.value;
                          setDetailEdit(f => ({ ...f, branch_id: newBranchId }));
                        }}
                      >
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <div className="customer-avatar avatar-placeholder">{getInitial(detailModal.employees?.name, 'A')}</div>
                    </div>
                    <div className="booking-row-content">
                      <div className="pos-relative">
                        <input
                          type="text"
                          className="form-input form-input-clean"
                          value={detailEdit.employee_search}
                          onChange={e => {
                            handleGenericSearch('employee', e.target.value, true);
                            if (detailEdit.employee_id) setDetailEdit(prev => ({ ...prev, employee_id: '' }));
                          }}
                          onFocus={() => handleGenericSearch('employee', detailEdit.employee_search, true)}
                          onBlur={() => setTimeout(() => setSearchSuggestions({ type: null, data: [], loading: false }), 200)}
                          placeholder="Nhân Viên"
                          autoComplete="off"
                        />
                        {searchSuggestions.type === 'employee' && searchSuggestions.loading && (
                          <div className="spinner-icon spinner-icon-right" />
                        )}
                        {searchSuggestions.type === 'employee' && searchSuggestions.data.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {searchSuggestions.data.map(emp => (
                              <div key={emp.id} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion('employee', emp, true)}>
                                <div className="customer-avatar">{getInitial(emp.name)}</div>
                                <div className="customer-info">
                                  <div className="autocomplete-name">{emp.name}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <img src={noteIcon} alt="note" className="icon-w24" />
                    </div>
                    <div className="booking-row-content">
                      <input
                        type="text"
                        className="form-input form-input-clean"
                        value={detailEdit.notes}
                        onChange={e => setDetailEdit(f => ({ ...f, notes: e.target.value }))}
                        placeholder="Thêm ghi chú"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="customer-view">
                  <div className="customer-profile-header">
                    <p className='customer-id'>Mã KH: {detailModal.customers?.id || 'Tạm thời'}</p>
                    <div className="customer-avatar-lg avatar-centered">
                      {getInitial(detailEdit.customer_name, 'A', { upper: true })}
                    </div>
                    <h2 className="modal-title-lg">{detailModal.temporary_name || detailModal.customers?.name || 'Khách tạm'}</h2>
                    {detailModal.customers?.id && (
                      <p className="customer-shared-note">Sửa thông tin ở đây sẽ cập nhật hồ sơ khách hàng (áp dụng cho mọi lịch của khách này).</p>
                    )}
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </div>
                    <div className="booking-row-content">
                      <input
                        className="form-input form-input-clean"
                        value={detailEdit.customer_name}
                        onChange={e => setDetailEdit(f => ({ ...f, customer_name: e.target.value }))}
                        placeholder="Tên khách"
                      />
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                    </div>
                    <div className="booking-row-content">
                      <input
                        className="form-input form-input-clean"
                        value={detailEdit.customer_phone}
                        onChange={e => setDetailEdit(f => ({ ...f, customer_phone: e.target.value }))}
                        placeholder="Số điện thoại"
                      />
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    </div>
                    <div className="booking-row-content">
                      <input
                        className="form-input form-input-clean form-input-readonly"
                        value={detailEdit.customer_email}
                        onChange={e => setDetailEdit(f => ({ ...f, customer_email: e.target.value }))}
                        placeholder="Email"
                      />
                    </div>
                  </div>

                  <div className="booking-row no-hover booking-row-top">
                    <div className="booking-row-icon">
                      <img src={noteIcon} alt="note" className="icon-w24 icon-mt-32" />
                    </div>
                    <div className="booking-row-content">
                      <textarea
                        className="form-textarea form-textarea-clean"
                        value={detailEdit.customer_habits}
                        onChange={e => setDetailEdit(f => ({ ...f, customer_habits: e.target.value }))}
                        placeholder="Ghi chú..."
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <div className="pos-relative" ref={moreMenuRef}>
                <button className="btn-icon btn-more" aria-label="Thêm thao tác" onClick={() => setShowDetailMore(!showDetailMore)}>
                  <FiMoreVertical />
                </button>
                {showDetailMore && (
                  <div className="more-menu">
                    <button className="more-menu-item" onClick={handleDuplicate}>
                      Nhân bản
                    </button>
                    <button className="more-menu-item danger-item" onClick={() => handleCancel(detailModal.id)}>
                      Hủy lịch
                    </button>
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary btn-save-detail"
                onClick={handleSaveDetail}
                disabled={detailSaving || !isDetailModified}
              >
                {detailSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )
      }
    </>
  );
}
