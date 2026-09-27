import { FiX } from 'react-icons/fi';
import { Tooltip } from '../ui/tooltip';
import { clickableProps } from '../../utils/a11y';
import { shortBranchName } from '../../utils/format';
import { EMPLOYEE_AVATAR_OVERRIDES, CUSTOMER_AVATAR_COLORS } from '../../config/business';

// Specification Rule 4: Flexible relative time note builder
const formatRelativeTime = (createdAtStr) => {
  if (!createdAtStr) return '';
  const now = new Date();
  const date = new Date(createdAtStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));

  // 1. In 1 hour: X minutes ago
  if (diffMins < 60) {
    if (diffMins <= 0) return 'Vừa xong';
    return `${diffMins} phút trước`;
  }

  // Check if in day
  const isToday = now.toDateString() === date.toDateString();
  if (isToday) {
    // 2. In day (and > 1h): Show exact hour
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  // Check if in 7 days
  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((now.getTime() - date.getTime()) / oneDayMs);

  if (diffDays < 7) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (yesterday.toDateString() === date.toDateString()) {
      return `Hôm qua`;
    }
    // 3. In 7 days: Day of week and date
    const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    const dayName = days[date.getDay()];
    const dayStr = String(date.getDate()).padStart(2, '0');
    const monthStr = String(date.getMonth() + 1).padStart(2, '0');
    return `${dayName}, ${dayStr}/${monthStr}`;
  }

  // 4. Over 7 days: Day and month
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return `${day} tháng ${month}`;
};

// Dynamic circular therapist and fallback initials avatar builder
const getAvatarInfo = (employeeName, customerName) => {
  const empNormalized = (employeeName || '').trim().toLowerCase();
  const override = EMPLOYEE_AVATAR_OVERRIDES.find(o => empNormalized.startsWith(o.prefix) || empNormalized.includes(o.contains));
  if (override) {
    return { letter: override.letter, bg: override.bg, color: override.color };
  }

  const nameToUse = customerName || 'Khách';
  const cleanName = nameToUse.trim().replace(/^(Anh|Chị|Chị|Em|C|A)\s+/i, '');
  const letter = cleanName ? cleanName.charAt(0).toUpperCase() : '👤';

  const colorIndex = letter.charCodeAt(0) % CUSTOMER_AVATAR_COLORS.length;
  return { letter, ...CUSTOMER_AVATAR_COLORS[colorIndex] };
};

// Panel thông báo trượt ra: lọc theo trạng thái / chi nhánh, nhóm theo ngày, đánh dấu đọc, xóa
// Component trình bày: state + handler vẫn nằm ở Sidebar.jsx, truyền vào qua props.
export default function NotificationPanel({
  activeFilter,
  branchFilterLabels,
  closePanel,
  deleteNotif,
  getGroupedNotifications,
  handleNotifClick,
  isClosing,
  loadingNotifs,
  markAllAsRead,
  panelOpen,
  panelRef,
  setActiveFilter,
  setPanelOpen,
  shouldRenderPanel,
  toggleReadStatus
}) {
  return (
    <>
      {shouldRenderPanel && (
        <div className={`notif-panel-container ${panelOpen ? 'open' : isClosing ? 'closing' : ''}`}>
          <div className="notif-panel" ref={panelRef} onClick={e => e.stopPropagation()}>
            <div className="notif-panel-header">
              <div className="notif-header-top">
                <span className="notif-title">Thông báo</span>
                <button className="btn-mark-all-read-top" onClick={markAllAsRead}>
                  <svg width="18" height="17" viewBox="0 0 18 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.75 7.41667L8.25 9.91667L16.5833 1.58333M11.5833 0.75H4.75C3.34987 0.75 2.6498 0.75 2.11502 1.02248C1.64462 1.26217 1.26217 1.64462 1.02248 2.11502C0.75 2.6498 0.75 3.34987 0.75 4.75V11.75C0.75 13.1501 0.75 13.8502 1.02248 14.385C1.26217 14.8554 1.64462 15.2378 2.11502 15.4775C2.6498 15.75 3.34987 15.75 4.75 15.75H11.75C13.1501 15.75 13.8502 15.75 14.385 15.4775C14.8554 15.2378 15.2378 14.8554 15.4775 14.385C15.75 13.8502 15.75 13.1501 15.75 11.75V8.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg> Đã đọc hết

                </button>
                <button className="btn-close-notif-top" aria-label="Đóng thông báo" onClick={closePanel}>
                  <FiX size={18} />
                </button>
              </div>

              {/* Filter Tags */}
              <div className="notif-filter-tags">
                <button
                  className={`notif-filter-tag${activeFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  Tất cả
                </button>
                <button
                  className={`notif-filter-tag${activeFilter === 'unread' ? ' active' : ''}`}
                  onClick={() => setActiveFilter('unread')}
                >
                  Chưa đọc
                </button>
                {/* Mỗi chi nhánh có thông báo một nút lọc (không còn viết cứng CN 1 / CN 2) */}
                {branchFilterLabels.map(label => (
                  <button
                    key={label}
                    className={`notif-filter-tag${activeFilter === `branch:${label}` ? ' active' : ''}`}
                    onClick={() => setActiveFilter(`branch:${label}`)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="notif-panel-body">
              {loadingNotifs ? (
                // Pulse Skeleton Loaders while fetching
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Array(4).fill(0).map((_, i) => (
                    <div key={i} className="skeleton-card">
                      <div className="skeleton-avatar pulsing"></div>
                      <div className="skeleton-content">
                        <div className="skeleton-line pulsing" style={{ width: '45%' }}></div>
                        <div className="skeleton-line pulsing" style={{ width: '75%' }}></div>
                        <div className="skeleton-line pulsing" style={{ width: '30%' }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : Object.keys(getGroupedNotifications()).length === 0 ? (
                // Sleep Bell Empty State
                <div className="notif-empty-state">
                  <div className="notif-empty-icon">
                    <svg width="72" height="72" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <ellipse cx="32" cy="52" rx="16" ry="4" fill="#F0F0EE" />
                      <path d="M42 40c0-6.627-4.477-12-10-12s-10 5.373-10 12h20z" fill="#DCDAD5" />
                      <path d="M46 44H18c0-2 2-4 4-4h20c2 0 4 2 4 4z" fill="#B3B0A8" />
                      <circle cx="32" cy="47" r="3.5" fill="#5C5A54" />
                      <circle cx="32" cy="24" r="3" fill="#DCDAD5" />
                      <path d="M48 18h4l-4 4h4" stroke="#8A8882" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M42 10h3l-3 3h3" stroke="#A8A6A0" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M27 35c0 .3.2.5.5.5s.5-.2.5-.5" stroke="#5C5A54" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M35 35c0 .3.2.5.5.5s.5-.2.5-.5" stroke="#5C5A54" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h4 className="notif-empty-title">Dễ chịu...</h4>
                  <p className="notif-empty-subtitle">Bạn đã xem hết thông báo rồi!</p>
                </div>
              ) : (
                // Grouped Notification Activity Cards
                Object.entries(getGroupedNotifications()).map(([dateGroup, items]) => (
                  <div key={dateGroup} className="notif-day-group">
                    {/* Day Divider Capsule */}
                    <div className={`notif-day-divider${dateGroup === 'Hôm nay' ? ' today' : ''}`}>
                      <span className="notif-day-label">{dateGroup}</span>
                    </div>

                    <div className="notif-day-content">
                      {items.map(n => {
                        const avatar = getAvatarInfo(n.employeeName, n.customerName);

                        // 12-hour AM/PM Time Formatter (e.g., 3:12 PM, 6:00 PM)
                        const formatBookingTime = (timeStr) => {
                          if (!timeStr) return '';
                          const parts = timeStr.split(':');
                          if (parts.length >= 2) {
                            let hours = parseInt(parts[0], 10);
                            const minutes = parts[1];
                            const ampm = hours >= 12 ? 'PM' : 'AM';
                            hours = hours % 12;
                            hours = hours ? hours : 12; // 0 hours should show as 12
                            return `${hours}:${minutes} ${ampm}`;
                          }
                          return timeStr;
                        };

                        // Determine Action Type based on status and note keywords
                        let actionType = 'Đặt lịch:';
                        if (n.status === 'cancelled') {
                          actionType = 'Hủy lịch:';
                        } else if (n.notes?.toLowerCase().includes('dời') || n.internal_note?.toLowerCase().includes('dời') || n.title?.toLowerCase().includes('dời')) {
                          actionType = 'Dời lịch:';
                        } else if (n.notes?.toLowerCase().includes('chỉnh') || n.internal_note?.toLowerCase().includes('chỉnh') || n.title?.toLowerCase().includes('chỉnh') || n.notes?.toLowerCase().includes('sửa') || n.internal_note?.toLowerCase().includes('sửa')) {
                          actionType = 'Chỉnh lịch:';
                        }

                        const bookingTime = formatBookingTime(n.startTime);
                        const guestsCount = n.numGuests || 1;
                        const branchNameClean = shortBranchName(n.branchName);
                        const staffText = n.employeeName ? ` (${n.employeeName})` : '';

                        let descText = `${actionType} ${bookingTime} — ${guestsCount} người — ${branchNameClean}${staffText}`;
                        let notesText = n.notes;

                        // Special parsing for Rescheduled slots ("Dời lịch: 6:00 PM — từ 3:00 PM")
                        const reschedulePattern = /(dời lịch|đổi lịch):\s*\d{1,2}:\d{2}\s*(?:PM|AM)?\s*—\s*từ\s*\d{1,2}:\d{2}\s*(?:PM|AM)?/i;

                        if (actionType === 'Dời lịch:') {
                          const match = (n.notes + ' ' + n.internal_note + ' ' + n.title).match(reschedulePattern);
                          if (match) {
                            descText = match[0];
                            if (n.notes && reschedulePattern.test(n.notes)) {
                              notesText = null; // Promote to description line and clear from note line
                            }
                          } else {
                            descText = `Dời lịch: ${bookingTime} — từ lịch cũ`;
                          }
                        }

                        return (
                          <div
                            key={n.id}
                            className={`notif-card-item${!n.read ? ' unread' : ' read'}`}
                            onClick={() => handleNotifClick(n)}
                            {...clickableProps(() => handleNotifClick(n))}
                          >
                            {/* Service Therapist Avatar */}
                            <div className='notif-card-header'>
                              <div className="notif-customer">
                                <div
                                  className="notif-avatar-circle"
                                  style={{ backgroundColor: avatar.bg, color: avatar.color }}
                                >
                                  {avatar.letter}

                                </div>
                                <span className="notif-customer-name">{n.customerName}</span>
                              </div>

                              <div className="notif-card-tool">
                                <div className="notif-header-right">
                                  {/* Quick action buttons aligned exactly to the right of the header on hover */}
                                  <div className="notif-card-actions">

                                    <Tooltip content={n.read ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}>
                                      <button
                                        className="btn-card-action"
                                        aria-label={n.read ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}
                                        onClick={(e) => { e.stopPropagation(); toggleReadStatus(n.id, n.read); }}
                                      >
                                        {n.read ? (
                                          <svg width="16" height="16" viewBox="0 0 18 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M8.63114 0.73913C9.03964 0.73913 9.37079 1.07005 9.37079 1.47826C9.37079 1.88647 9.03964 2.21739 8.63114 2.21739H4.68443C3.98183 2.21739 3.49922 2.21765 3.1252 2.24819C2.75989 2.27802 2.56323 2.33274 2.42119 2.40506C2.09663 2.57038 1.83253 2.83429 1.6671 3.15863C1.59473 3.30056 1.53997 3.49709 1.51011 3.86215C1.47956 4.23591 1.4793 4.71817 1.4793 5.42029V12.3188C1.4793 13.021 1.47956 13.5032 1.51011 13.877C1.53997 14.242 1.59473 14.4386 1.6671 14.5805C1.83253 14.9048 2.09663 15.1687 2.42119 15.3341C2.56323 15.4064 2.75989 15.4611 3.1252 15.4909C3.49922 15.5215 3.98183 15.5217 4.68443 15.5217H11.5878C12.2904 15.5217 12.773 15.5215 13.147 15.4909C13.5123 15.4611 13.709 15.4064 13.851 15.3341C14.1756 15.1688 14.4397 14.9048 14.6051 14.5805C14.6775 14.4386 14.7323 14.242 14.7621 13.877C14.7927 13.5032 14.7929 13.021 14.7929 12.3188L14.7968 9.85411C14.7974 9.44596 15.129 9.11541 15.5374 9.11594C15.9458 9.11658 16.2766 9.44791 16.2761 9.85603L16.2722 12.3198C16.2722 12.9971 16.2732 13.5496 16.2366 13.9973C16.1993 14.4538 16.119 14.8662 15.9226 15.2513C15.6154 15.8538 15.1252 16.3436 14.5223 16.6506C14.137 16.8468 13.7243 16.9271 13.2674 16.9644C12.8192 17.001 12.266 17 11.5878 17H4.68443C4.00624 17 3.45305 17.001 3.00482 16.9644C2.54796 16.9271 2.13526 16.8468 1.74992 16.6506C1.14699 16.3436 0.656861 15.8538 0.349601 15.2513C0.153261 14.8662 0.0729647 14.4538 0.0356366 13.9973C-0.000985338 13.5494 2.58887e-06 12.9966 2.58887e-06 12.3188V5.42029C2.58887e-06 4.74257 -0.000985338 4.18977 0.0356366 3.74185C0.0729647 3.28531 0.153261 2.8729 0.349601 2.48783C0.656861 1.88532 1.14699 1.39553 1.74992 1.08848C2.13526 0.892282 2.54796 0.812042 3.00482 0.77474C3.45305 0.738143 4.00624 0.73913 4.68443 0.73913H8.63114Z" fill="currentColor" />
                                            <path fillRule="evenodd" clipRule="evenodd" d="M14.0552 0C16.2339 0 18 1.76491 18 3.94203C18 6.11915 16.2339 7.88406 14.0552 7.88406C11.8766 7.88406 10.1104 6.11915 10.1104 3.94203C10.1104 1.76491 11.8766 1.52383e-06 14.0552 0ZM14.0552 1.47826C12.6936 1.47826 11.5897 2.58133 11.5897 3.94203C11.5897 5.30273 12.6936 6.40579 14.0552 6.4058C15.4169 6.4058 16.5207 5.30273 16.5207 3.94203C16.5207 2.58133 15.4169 1.47826 14.0552 1.47826Z" fill="currentColor" />
                                          </svg>
                                        ) : (
                                          <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 18 17"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m5.75 7.42 2.5 2.5 8.33-8.34m-5-.83H4.75c-1.4 0-2.1 0-2.63.27a2.5 2.5 0 0 0-1.1 1.1C.75 2.65.75 3.35.75 4.75v7c0 1.4 0 2.1.27 2.64q.37.72 1.1 1.09c.53.27 1.23.27 2.63.27h7c1.4 0 2.1 0 2.64-.27a2.5 2.5 0 0 0 1.09-1.1c.27-.53.27-1.23.27-2.63v-3.5"/></svg>
                                        )}
                                      </button>
                                    </Tooltip>
                                    <Tooltip content="Xóa">
                                      <button
                                        className="btn-card-action"
                                        aria-label="Xóa thông báo"
                                        onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }}
                                      >
                                        <svg width="16" height="16" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <path d="M5.75 0.75H10.75M0.75 3.25H15.75M14.0833 3.25L13.4989 12.0161C13.4112 13.3313 13.3674 13.9889 13.0833 14.4875C12.8333 14.9265 12.456 15.2794 12.0014 15.4997C11.485 15.75 10.8259 15.75 9.50779 15.75H6.99221C5.67409 15.75 5.01503 15.75 4.49861 15.4997C4.04396 15.2794 3.66674 14.9265 3.41665 14.4875C3.13259 13.9889 3.08875 13.3313 3.00107 12.0161L2.41667 3.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                                        </svg>
                                      </button>
                                    </Tooltip>
                                  </div>
                                  <span className="notif-card-time">
                                    {formatRelativeTime(n.createdAt)}
                                  </span>
                                  <Tooltip content={`${guestsCount} người`} disabled={n.read}>
                                    <span className="notif-guests-badge-top">
                                      {guestsCount}
                                    </span>
                                  </Tooltip>                                 
                                </div>
                              </div>
                            </div>

                            {/* Content description (Action Type & Booking details) */}
                            <p className="notif-card-desc">
                              {descText}
                            </p>

                            {/* Notes (If present) */}
                            {notesText && !reschedulePattern.test(notesText) && (
                              <p className="notif-card-notes-text">
                                Note: {notesText}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="notif-panel-overlay" onClick={() => setPanelOpen(false)}></div>
        </div>
      )}
    </>
  );
}
