import { isHoldBooking, isSpamWarningBooking, bookingStatusLabel } from '../../utils/booking';
import { FiCalendar, FiAlertTriangle, FiUsers } from 'react-icons/fi';
import { formatPrice, formatTime, setGroupHighlight } from './helpers';

// Trạng thái chung của thẻ nhóm: các khách khác trạng thái nhau → 'mixed'
const groupStatusLabel = (status) => (status === 'mixed' ? 'Nhiều trạng thái' : bookingStatusLabel(status));

// Dạng danh sách: bảng (desktop) hoặc thẻ gộp theo nhóm khách (mobile)
// Component trình bày: state + handler vẫn nằm ở Bookings.jsx, truyền vào qua props.
export default function BookingListView({
  bookings,
  groupInfoById,
  handleOpenDetail,
  handleRetryLoad,
  isMobile,
  loadError,
  loading,
  mobileListItems
}) {
  return (
    <>
        <div className="card no-border">
          {/* Desktop Table */}
          {!isMobile ? (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Khách hàng</th>
                    <th>Dịch vụ</th>
                    <th>Chi nhánh</th>
                    <th>Ngày</th>
                    <th>Giờ</th>
                    <th>Nhân viên</th>
                    <th>Ghi chú</th>
                    <th>Trạng thái</th>
                    <th>Giá</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <tr key={`skeleton-row-${idx}`}>
                        <td colSpan="9" style={{ padding: '16px 24px' }}>
                          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <div className="skeleton-shimmer-light" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div className="skeleton-shimmer-light" style={{ width: '30%', height: '16px', borderRadius: '4px' }} />
                              <div className="skeleton-shimmer-light" style={{ width: '50%', height: '12px', borderRadius: '4px' }} />
                            </div>
                            <div className="skeleton-shimmer-light" style={{ width: '80px', height: '24px', borderRadius: '12px' }} />
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : loadError ? (
                    <tr>
                      <td colSpan="9">
                        <div className="empty-state" role="alert">
                          <FiAlertTriangle size={32} />
                          <h4>Không tải được lịch hẹn</h4>
                          <p>{loadError}</p>
                          <button type="button" className="btn btn-sm btn-primary" onClick={handleRetryLoad}>Thử lại</button>
                        </div>
                      </td>
                    </tr>
                  ) : bookings.length === 0 ? (
                    <tr>
                      <td colSpan="9">
                        <div className="empty-state">
                          <FiCalendar size={32} />
                          <h4>Không có lịch hẹn</h4>
                          <p>Chưa có lịch hẹn nào trong ngày này</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    bookings.map(b => {
                      const groupInfo = groupInfoById.get(b.id);
                      return (
                        <tr
                          key={b.id}
                          id={`booking-card-${b.id}`}
                          data-group-id={groupInfo?.groupId}
                          onMouseEnter={groupInfo ? () => setGroupHighlight(groupInfo.groupId, true) : undefined}
                          onMouseLeave={groupInfo ? () => setGroupHighlight(groupInfo.groupId, false) : undefined}
                          onClick={() => handleOpenDetail(b)}
                          className={`cursor-pointer${isSpamWarningBooking(b) ? ' row-spam-warning' : ''}${isHoldBooking(b) ? ' is-hold-disabled' : ''}`}
                        >
                          <td>
                            <div className="list-booking-name">
                              {b.temporary_name || b.customers?.name || '-'}
                              {groupInfo && (
                                <span className="group-chip" title={`Khách ${groupInfo.index} trong nhóm ${groupInfo.size} khách`}>
                                  <FiUsers size={11} /> Nhóm {groupInfo.size}
                                </span>
                              )}
                            </div>
                            <div className="list-booking-phone">{b.customers?.phone || ''}</div>
                          </td>
                          <td>{b.services?.name || '-'}</td>
                          <td>{b.branches?.name || '-'}</td>
                          <td>{new Date(b.booking_date + 'T00:00:00').toLocaleDateString('vi-VN')}</td>
                          <td>{formatTime(b.start_time)} - {formatTime(b.end_time)}</td>
                          <td>{b.employees?.name || '-'}</td>
                          <td>
                            {b.notes || '-'}
                            {b.internal_note && <div className="list-booking-note">{b.internal_note}</div>}
                          </td>
                          <td>
                            <span className={`badge badge-${b.status}`}>{bookingStatusLabel(b.status)}</span>
                          </td>
                          <td className="list-booking-price">{formatPrice(b.total_price)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Mobile Card Layout */
            <div className="booking-list-mobile">
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`skeleton-card-${idx}`} className="booking-card-mobile" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div className="skeleton-shimmer-light" style={{ width: '120px', height: '16px', borderRadius: '4px' }} />
                      <div className="skeleton-shimmer-light" style={{ width: '80px', height: '16px', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div className="skeleton-shimmer-light" style={{ width: '80px', height: '12px', borderRadius: '4px' }} />
                      <div className="skeleton-shimmer-light" style={{ width: '60px', height: '12px', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div className="skeleton-shimmer-light" style={{ width: '50px', height: '20px', borderRadius: '10px' }} />
                      <div className="skeleton-shimmer-light" style={{ width: '60px', height: '20px', borderRadius: '4px' }} />
                    </div>
                  </div>
                ))
              ) : loadError ? (
                <div className="empty-state" role="alert">
                  <FiAlertTriangle size={32} />
                  <h4>Không tải được lịch hẹn</h4>
                  <p>{loadError}</p>
                  <button type="button" className="btn btn-sm btn-primary" onClick={handleRetryLoad}>Thử lại</button>
                </div>
              ) : bookings.length === 0 ? (
                <div className="empty-state">
                  <FiCalendar size={32} />
                  <h4>Không có lịch hẹn</h4>
                  <p>Chưa có lịch hẹn nào trong ngày này</p>
                </div>
              ) : (
                mobileListItems.map(({ key, lead, members, ids, guestCount, status, hasSpamWarning, isHold, endTime, serviceNames, notes, internalNotes }) => {
                  const isGroup = guestCount > 1;
                  // Thẻ nhóm: mở lịch đầu tiên (không phải giữ chỗ) ở chế độ nhóm → sửa ngày/giờ, hủy áp dụng cho cả nhóm
                  const target = isGroup ? (members.find(m => !isHoldBooking(m)) || lead) : lead;
                  return (
                    <div
                      key={key}
                      id={`booking-card-${lead.id}`}
                      data-booking-ids={ids.join(' ')}
                      className={`booking-card-mobile${hasSpamWarning ? ' row-spam-warning' : ''}${isHold ? ' is-hold-disabled' : ''}${isGroup ? ' is-group' : ''}`}
                      onClick={() => { if (!isHold) handleOpenDetail(target, { groupMode: isGroup }); }}
                    >
                      <div className="booking-card-mobile-header">
                        <span className="booking-card-mobile-customer">{lead.temporary_name || lead.customers?.name || '-'}</span>
                        <span className="booking-card-mobile-time">{formatTime(lead.start_time)} - {formatTime(endTime)} · {guestCount} khách</span>
                      </div>
                      <div className="booking-card-mobile-body">
                        <span className="booking-card-mobile-service">
                          <span className="service-icon-dot sm" style={{ background: lead.services?.color || '#0d8a3f' }}></span>
                          {serviceNames || '-'}
                        </span>
                        <span className={`badge badge-${status}`}>{groupStatusLabel(status)}</span>
                      </div>

                      {notes.length > 0 && (
                        <div className="booking-card-mobile-footer">
                          <div className="booking-card-mobile-notes">{notes.join('\n')}</div>
                        </div>
                      )}
                      {internalNotes.map(note => (
                        <div key={note} className="booking-card-mobile-footer">
                          <div className="list-booking-note">{note}</div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
    </>
  );
}
