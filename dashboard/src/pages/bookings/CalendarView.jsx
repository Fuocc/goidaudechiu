import { isHoldBooking, isSpamWarningBooking } from '../../utils/booking';
import { Tooltip } from '../../components/ui/tooltip';
import { FiAlertTriangle, FiUsers } from 'react-icons/fi';
import { WEEKDAY_MIN_OPEN_MINUTES } from '../../config/business';
import { OPEN_HOUR, CLOSE_HOUR, HOURS, ROW_HEIGHT, toDateStr, timeToMinutes, getBookingColor, formatTime, convertYToTime, setGroupHighlight } from './helpers';
import noteIcon from '../../assets/note-icon.svg';

// Dạng lưới lịch theo nhân viên: kéo tạo lịch, kéo đổi lịch, vạch giờ hiện tại
// Component trình bày: state + handler vẫn nằm ở Bookings.jsx, truyền vào qua props.
export default function CalendarView({
  bookingsByEmployee,
  branches,
  cardDrag,
  currentDate,
  dragInfo,
  employeeSchedules,
  employees,
  filterBranch,
  gridRef,
  groupInfoById,
  handleCardDragStart,
  handleColumnHover,
  handleDragStart,
  handleRetryLoad,
  hoverInfo,
  loadError,
  loading,
  now,
  nowLineRef,
  setHoverInfo
}) {
  return (
    <>
        <div className="cal-scroll-wrapper">
          {loadError && !loading && (
            <div className="load-error-banner" role="alert">
              <FiAlertTriangle size={16} />
              <span>Không tải được lịch hẹn: {loadError}</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={handleRetryLoad}>Thử lại</button>
            </div>
          )}

          <div className="cal-container">

            <div className='calendar-grid' ref={gridRef}>
              {/* Time labels column */}
              <div className="cal-time-column">
                {HOURS.map(hour => (
                  <div key={hour} className="cal-time-slot">
                    {(() => {
                      const h12 = hour % 12 === 0 ? 12 : hour % 12;
                      const period = hour < 12 ? 'AM' : 'PM';
                      return (
                        <>
                          {String(h12).padStart(2)}<span>{period}</span>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>

              {/* Hover ghost (rendered in grid layer) */}
              {hoverInfo && !dragInfo && !cardDrag && (
                <div
                  className="cal-hover-ghost"
                  style={{
                    top: `${hoverInfo.y}px`,
                    left: `${hoverInfo.colLeft + 4}px`,
                    width: `${hoverInfo.colWidth - 8}px`,
                    height: `${ROW_HEIGHT}px`
                  }}
                >
                  {formatTime(hoverInfo.time)}
                </div>
              )}

              {/* Staff columns */}
              {loading ? (
                // Calendar View Skeleton (3 columns)
                Array.from({ length: 3 }).map((_, colIdx) => (
                  <div
                    key={`skeleton-col-${colIdx}`}
                    className="cal-staff-column available skeleton-col"
                    style={{ minHeight: '1400px', backgroundColor: '#ffffff', opacity: 0.8 }}
                  >
                    <div
                      className="skeleton-shimmer-light"
                      style={{
                        position: 'absolute',
                        top: '120px',
                        left: '8px',
                        right: '8px',
                        height: '90px',
                        borderRadius: '8px',
                        opacity: 0.6
                      }}
                    />
                    <div
                      className="skeleton-shimmer-light"
                      style={{
                        position: 'absolute',
                        top: '320px',
                        left: '8px',
                        right: '8px',
                        height: '140px',
                        borderRadius: '8px',
                        opacity: 0.6
                      }}
                    />
                    <div
                      className="skeleton-shimmer-light"
                      style={{
                        position: 'absolute',
                        top: '650px',
                        left: '8px',
                        right: '8px',
                        height: '80px',
                        borderRadius: '8px',
                        opacity: 0.6
                      }}
                    />
                  </div>
                ))
              ) : (
                (() => {
                  const currentDayEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDate.getDay()];
                  const currentBranchInfo = branches.find(b => b.id === filterBranch);
                  const branchDaySchedule = currentBranchInfo?.opening_hours?.[currentDayEn];
                  const branchIsOpen = branchDaySchedule ? branchDaySchedule.isOpen : true;

                  const baseBranchOpenMin = branchDaySchedule?.open ? timeToMinutes(branchDaySchedule.open) : OPEN_HOUR * 60;
                  const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(currentDayEn);
                  const branchOpenMin = isWeekday ? Math.max(baseBranchOpenMin, WEEKDAY_MIN_OPEN_MINUTES) : baseBranchOpenMin;
                  const branchCloseMin = branchDaySchedule?.close ? timeToMinutes(branchDaySchedule.close) : CLOSE_HOUR * 60;

                  return employees.map((emp, empIndex) => {
                    const empSched = employeeSchedules.find(s => s.employee_id === emp.id);
                    let isAvailable = empSched && !empSched.is_day_off && branchIsOpen;

                    let startPx = 0;
                    let endPx = 0;
                    if (isAvailable) {
                      const empStartMin = timeToMinutes(String(empSched.start_time).substring(0, 5));
                      const empEndMin = timeToMinutes(String(empSched.end_time).substring(0, 5));
                      const startMin = Math.max(empStartMin, branchOpenMin);
                      const endMin = Math.max(Math.min(empEndMin, branchCloseMin), 23 * 60);
                      if (startMin >= endMin) {
                        isAvailable = false;
                      } else {
                        startPx = ((startMin - OPEN_HOUR * 60) / 60) * 100;
                        endPx = ((endMin - OPEN_HOUR * 60) / 60) * 100;
                      }
                    }

                    return (
                      <div
                        key={emp.id}
                        className={`cal-staff-column ${isAvailable ? 'available' : 'unavailable'} ${empIndex === 0 ? 'is-first-staff' : ''}`}
                        data-staff-id={emp.id}
                        data-staff-name={emp.name}
                        style={{
                          '--shift-start': isAvailable ? `${startPx}px` : '0px',
                          '--shift-end': isAvailable ? `${endPx}px` : '0px'
                        }}
                        onMouseDown={(e) => handleDragStart(e, emp)}
                        onMouseMove={(e) => handleColumnHover(e, emp)}
                        onMouseLeave={() => { if (!dragInfo) setHoverInfo(null); }}
                      >
                        {/* Unavailable overlays to disable drag-to-create and set cursor to not-allowed */}
                        {!isAvailable ? (
                          <div
                            className="cal-unavailable-overlay"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              cursor: 'not-allowed',
                              zIndex: 5,
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            onMouseMove={(e) => {
                              e.stopPropagation();
                            }}
                          />
                        ) : (
                          <>
                            {startPx > 0 && (
                              <div
                                className="cal-unavailable-overlay"
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  height: `${startPx}px`,
                                  cursor: 'not-allowed',
                                  zIndex: 5,
                                }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                                onMouseMove={(e) => {
                                  e.stopPropagation();
                                }}
                              />
                            )}
                            {endPx < 1400 && (
                              <div
                                className="cal-unavailable-overlay"
                                style={{
                                  position: 'absolute',
                                  top: `${endPx}px`,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  cursor: 'not-allowed',
                                  zIndex: 5,
                                }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                                onMouseMove={(e) => {
                                  e.stopPropagation();
                                }}
                              />
                            )}
                          </>
                        )}
                        {/* Now Line (rendered in each column or once for the whole grid) */}
                        {toDateStr(currentDate) === toDateStr(now) && (() => {
                          const nowY = (timeToMinutes(`${now.getHours()}:${now.getMinutes()}`) - OPEN_HOUR * 60) / 60 * 100;
                          const hideTriangle = hoverInfo && Math.abs(hoverInfo.y - nowY) <= 25;
                          return (
                            <div ref={nowLineRef} className={`cal-now-line ${hideTriangle ? 'hide-triangle' : ''}`} style={{ top: `${nowY}px` }}>
                              {/* We only show badge on the first column for cleaner UI */}
                              {empIndex === 0 && (
                                <div className="cal-now-badge">
                                  {(() => {
                                    const h = now.getHours();
                                    const m = String(now.getMinutes()).padStart(2, '0');
                                    const h12 = h % 12 === 0 ? 12 : h % 12;
                                    const period = h < 12 ? 'AM' : 'PM';
                                    return `${String(h12).padStart(2, '0')}:${m} ${period}`;
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Bookings for this staff */}
                        {(bookingsByEmployee.get(emp.id) || []).map(b => {
                          const startMin = timeToMinutes(b.start_time);
                          const endMin = timeToMinutes(b.end_time);
                          const top = (startMin - OPEN_HOUR * 60) / 60 * 100;
                          const height = (endMin - startMin) / 60 * 100;
                          const cardBg = getBookingColor(b);
                          const textColor = '#555555';

                          const isHold = isHoldBooking(b);
                          const isSpamWarning = isSpamWarningBooking(b);
                          const groupInfo = groupInfoById.get(b.id);

                          return (
                            <div
                              key={b.id}
                              id={`booking-card-${b.id}`}
                              data-group-id={groupInfo?.groupId}
                              onMouseEnter={groupInfo ? () => setGroupHighlight(groupInfo.groupId, true) : undefined}
                              onMouseLeave={groupInfo ? () => setGroupHighlight(groupInfo.groupId, false) : undefined}
                              className={`cal-booking-card-wrapper${cardDrag && cardDrag.booking.id === b.id ? ' is-original-placeholder' : ''}${isSpamWarning ? ' is-spam-warning' : ''}${isHold ? ' is-hold-disabled' : ''}`}
                              style={{
                                position: 'absolute',
                                top: `${top}px`,
                                width: '100%',
                                zIndex: 10
                              }}
                              onMouseDown={(e) => handleCardDragStart(e, b)}
                            >
                              <div
                                className="cal-booking-card"
                                style={{
                                  height: `calc(${height}px - 4px)`,
                                  backgroundColor: cardBg,
                                  color: textColor,
                                }}
                              >
                                {b.notes && (
                                  <Tooltip content={b.notes} placement="top">
                                    <img src={noteIcon} alt={b.notes} className="cal-booking-icon" />
                                  </Tooltip>
                                )}
                                <div className="cal-booking-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {isSpamWarning && <FiAlertTriangle size={12} className="cal-alert-icon" />}
                                  {groupInfo && (
                                    <span className="cal-group-chip" title={`Nhóm ${groupInfo.size} khách`}>
                                      <FiUsers size={10} /> {groupInfo.index}/{groupInfo.size}
                                    </span>
                                  )}
                                  {b.temporary_name || b.customers?.name}
                                </div>
                                <div className="cal-booking-service">{b.services?.name}</div>
                                <div className="cal-booking-time">{formatTime(b.start_time)} - {formatTime(b.end_time)}</div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Card drag ghost */}
                        {cardDrag && cardDrag.currentCol?.getAttribute('data-staff-id') === emp.id && (() => {
                          const b = cardDrag.booking;
                          const ghostStart = convertYToTime(cardDrag.currentTop);
                          const ghostEnd = convertYToTime(cardDrag.currentTop + cardDrag.heightPx);
                          const cardBg = getBookingColor(b);
                          const textColor = '#555555';

                          return (
                            <div
                              className="cal-booking-card-wrapper is-moving-active"
                              style={{
                                position: 'absolute',
                                top: `${cardDrag.currentTop}px`,
                                width: '100%',
                                zIndex: 100
                              }}
                            >
                              <div
                                className="cal-booking-card"
                                style={{
                                  height: `${cardDrag.heightPx}px`,
                                  backgroundColor: cardBg,
                                  color: textColor,
                                }}
                              >
                                {b.notes && (
                                  <Tooltip content={b.notes} placement="top">
                                    <img src={noteIcon} alt={b.notes} className="cal-booking-icon" />
                                  </Tooltip>
                                )}
                                <div className="cal-booking-name">{b.temporary_name || b.customers?.name}</div>
                                <div className="cal-booking-service">{b.services?.name}</div>
                                <div className="cal-booking-time">{formatTime(ghostStart)} - {formatTime(ghostEnd)}</div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Drag selection overlay */}
                        {dragInfo && dragInfo.staffId === emp.id && (() => {
                          const top = dragInfo.startY;
                          const height = Math.max(ROW_HEIGHT, dragInfo.currentY - dragInfo.startY);
                          const startT = convertYToTime(top);
                          const endT = convertYToTime(top + height);
                          return (
                            <div
                              className="cal-drag-selection"
                              style={{ top: `${top}px`, height: `${height}px` }}
                            >
                              <span className="cal-drag-time">{formatTime(startT)} – {formatTime(endT)}</span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })
                })()
              )}
            </div>
          </div>
        </div>
    </>
  );
}
