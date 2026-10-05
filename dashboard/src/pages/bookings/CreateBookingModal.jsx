import { getInitial } from '../../utils/format';
import { clickableProps } from '../../utils/a11y';
import { DatePicker, parseDate } from '@chakra-ui/react';
import { FiPlus } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { formatPrice, calculateEndTime } from './helpers';
import TimePickerInput from '../../components/TimePickerInput';
import BusyLabel from '../../components/BusyLabel';
import userIcon from '../../assets/user-icon.svg';
import shopIcon from '../../assets/shop-icon.svg';
import clockIcon from '../../assets/clock-icon.svg';
import noteIcon from '../../assets/note-icon.svg';

// Modal tạo lịch hẹn mới (Dịch vụ, Ngày & giờ, Khách, Chi nhánh, Nhân viên, Ghi chú)
// Component trình bày: state + handler vẫn nằm ở Bookings.jsx, truyền vào qua props.
export default function CreateBookingModal({
  bookForm,
  bookModalRef,
  branches,
  calendarRef,
  checkStaffAvailability,
  customerView,
  handleBookSubmit,
  handleGenericSearch,
  handleSelectSuggestion,
  isCreating,
  modalOpen,
  requestCloseBookModal,
  searchSuggestions,
  selectedService,
  setBookForm,
  setCustomerView,
  setModalOpen,
  setSearchSuggestions,
  setShowCalendar,
  showCalendar
}) {
  return (
    <>
      {
        modalOpen && (
          <div className="modal-overlay" onClick={requestCloseBookModal}>
            <div className="modal modal-max-480" ref={bookModalRef} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Lịch mới</h3>
                <button className="modal-close" aria-label="Đóng" onClick={() => setModalOpen(false)}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 5L5 19" stroke="black" stroke-miterlimit="10"></path>
                    <path d="M5 5L19 19" stroke="black" stroke-miterlimit="10"></path>
                  </svg>
                </button>
              </div>
              <form onSubmit={handleBookSubmit}>
                <div className="modal-body">
                  {/* 1 Row: Dịch vụ */}
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <div className="service-icon-dot sm" style={{ background: selectedService?.color || '#F8F3EC' }}></div>
                    </div>
                    <div className="booking-row-content">
                      <div className="pos-relative">
                        <input
                          type="text"
                          className={`form-input form-input-service ${!bookForm.service_id && bookForm.service_search ? 'error' : ''}`}
                          value={bookForm.service_search}
                          onChange={e => {
                            handleGenericSearch('service', e.target.value);
                            if (bookForm.service_id) setBookForm(prev => ({ ...prev, service_id: '' }));
                          }}
                          onFocus={() => handleGenericSearch('service', bookForm.service_search)}
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
                                <div key={s.id} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion('service', s)}>
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

                  {/* 1 Row: Ngày & Giờ */}
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <img src={clockIcon} alt="date" />
                    </div>
                    <div className="booking-row-content new-customer-fields">
                      <div className="booking-date-container">
                        <input
                          type="text"
                          className="form-input form-input-readonly"
                          readOnly
                          value={bookForm.booking_date ? new Date(bookForm.booking_date).toLocaleDateString('vi-VN') : '--/--/----'}
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
                              value={bookForm.booking_date ? [parseDate(bookForm.booking_date)] : []}
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

                                  const newDate = dateStr;

                                  const handleDateUpdate = async () => {
                                    let shouldClearEmployee = false;
                                    if (bookForm.employee_id) {
                                      const avail = await checkStaffAvailability(bookForm.employee_id, newDate, bookForm.start_time, bookForm.end_time);
                                      if (!avail) shouldClearEmployee = true;
                                    }

                                    setBookForm(f => ({
                                      ...f,
                                      booking_date: newDate,
                                      ...(shouldClearEmployee ? { employee_id: '', employee_search: '' } : {})
                                    }));
                                  };

                                  handleDateUpdate();
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
                          value={bookForm.start_time}
                          onChange={val => {
                            setBookForm(f => ({ ...f, start_time: val, end_time: calculateEndTime(val, selectedService?.duration_minutes || 0) }));
                          }}
                        />
                        <span className="time-separator-text">—</span>
                        <TimePickerInput
                          value={bookForm.end_time}
                          onChange={val => setBookForm(f => ({ ...f, end_time: val }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 1 Row: Khách hàng */}
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      {customerView === 'selected' || customerView === 'creating' ? (
                        <div className="customer-avatar customer-avatar-selected">{getInitial(bookForm.customer_name, 'A', { upper: true })}</div>
                      ) : (
                        <img src={userIcon} alt="user" />
                      )}
                    </div>
                    <div className="booking-row-content">
                      {customerView === 'default' && <div className="booking-row-title placeholder-text-dim cursor-pointer" onClick={() => setCustomerView('searching')} {...clickableProps(() => setCustomerView('searching'))}>Thêm Khách</div>}

                      {customerView === 'searching' && (
                        <div className="pos-relative">
                          <input
                            type="text"
                            className="form-input form-input-search"
                            autoFocus
                            value={bookForm.customer_name}
                            onChange={e => handleGenericSearch('customer', e.target.value)}
                            onFocus={e => handleGenericSearch('customer', e.target.value)}
                            onBlur={() => setTimeout(() => {
                              if (customerView !== 'selected' && customerView !== 'creating' && !bookForm.customer_name) {
                                setCustomerView('default');
                              }
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
                                <div key={c.id} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion('customer', c)}>
                                  <div className="customer-avatar">{getInitial(c.name)}</div>
                                  <div className="customer-info">
                                    <div className="autocomplete-name">{c.name}</div>
                                    <div className="customer-phone">{c.phone}</div>
                                  </div>
                                </div>
                              ))}
                              <div className="autocomplete-footer" onMouseDown={() => handleSelectSuggestion('customer', 'new')}>
                                <FiPlus /> Tạo Khách Mới
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {customerView === 'selected' && (
                        <div className="customer-info py-0" onClick={() => setCustomerView('searching')} {...clickableProps(() => setCustomerView('searching'))}>
                          <div className="booking-row-title">{bookForm.customer_name}</div>
                          <div className="customer-phone">{bookForm.customer_phone}</div>
                        </div>
                      )}

                      {customerView === 'creating' && (
                        <div className="new-customer-fields">
                          <input className="form-input form-input-clean" placeholder="Tên khách"
                            value={bookForm.customer_name} onChange={e => setBookForm(f => ({ ...f, customer_name: e.target.value }))} />
                          <input className="form-input phone-input-sm" placeholder="Nhập SĐT"
                            value={bookForm.customer_phone} onChange={e => setBookForm(f => ({ ...f, customer_phone: e.target.value }))} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 1 Row: Chi nhánh */}
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <img src={shopIcon} alt="branch" />
                    </div>
                    <div className="booking-row-content">
                      <select className="form-select form-select-clean"
                        value={bookForm.branch_id} onChange={e => setBookForm(prev => ({ ...prev, branch_id: e.target.value }))}>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* 1 Row: Nhân viên */}
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <div className="customer-avatar employee-avatar-placeholder">{getInitial(bookForm.employee_search, 'A')}</div>
                    </div>
                    <div className="booking-row-content">
                      <div className="pos-relative">
                        <input
                          type="text"
                          className="form-input form-input-clean"
                          value={bookForm.employee_search}
                          onChange={e => handleGenericSearch('employee', e.target.value)}
                          onFocus={e => handleGenericSearch('employee', e.target.value)}
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
                              <div key={emp.id} className="autocomplete-item" onMouseDown={() => handleSelectSuggestion('employee', emp)}>
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

                  {/* 1 Row: Ghi chú */}
                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <img src={noteIcon} alt="notes" />
                    </div>
                    <div className="booking-row-content">
                      <input className="form-input form-input-clean"
                        placeholder="Notes" value={bookForm.notes} onChange={e => setBookForm({ ...bookForm, notes: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="submit" className="btn btn-primary btn-submit-booking" disabled={isCreating} aria-busy={isCreating}>
                    <BusyLabel busy={isCreating} text="Đang tạo...">Tạo</BusyLabel>
                  </button>
                </div>
              </form>
            </div>
          </div >
        )
      }
    </>
  );
}
