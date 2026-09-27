import { Tooltip } from '../../components/ui/tooltip';
import { FiPlus, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { formatDateVietnamese } from './helpers';
import BranchDropdown from '../../components/BranchDropdown';

// Thanh công cụ: chọn chi nhánh, đổi ngày, Hôm nay, chuyển dạng lịch/danh sách, Tạo lịch + hàng tên nhân viên
// Component trình bày: state + handler vẫn nằm ở Bookings.jsx, truyền vào qua props.
export default function BookingToolbar({
  branches,
  currentDate,
  employeeSchedules,
  employees,
  filterBranch,
  goNext,
  goPrev,
  goToday,
  isMobile,
  isToday,
  loading,
  openBookingModal,
  setFilterBranch,
  setViewMode,
  viewMode
}) {
  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-toolbar-desktop">
          <div className="cal-toolbar-left">
            <BranchDropdown
              branches={branches}
              value={filterBranch}
              onChange={setFilterBranch}
            />

          </div>
          <div className="cal-toolbar-middle">
            <span className="cal-week-label">
              {formatDateVietnamese(currentDate)}
            </span>
            <Tooltip content="Ngày trước">
              <button className="btn-icon" aria-label="Ngày trước" onClick={goPrev}><FiChevronLeft /></button>
            </Tooltip>
            <Tooltip content="Ngày sau">
              <button className="btn-icon" aria-label="Ngày sau" onClick={goNext}><FiChevronRight /></button>
            </Tooltip>
            <Tooltip content={isToday ? "Đang xem lịch hôm nay" : "Trở về hôm nay"}>
              <button 
                className={`btn btn-sm btn-ghost btn-today${isToday ? ' active' : ''}`} 
                onClick={goToday}
              >
                Hôm nay
              </button>
            </Tooltip>
          </div>
          <div className="cal-toolbar-right">
            {/* Hide view toggle on mobile — mobile always shows list */}
            {!isMobile && (
              <div className="cal-view-toggle">
                <Tooltip content="View Lịch">
                <button className={`cal-view-btn${viewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')}>
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4.39984 0.916748H3.84984C2.82307 0.916748 2.30969 0.916748 1.91752 1.11657C1.57256 1.29234 1.29209 1.5728 1.11633 1.91777C0.916504 2.30994 0.916504 2.82332 0.916504 3.85008V14.4834C0.916504 15.5102 0.916504 16.0236 1.11633 16.4157C1.29209 16.7607 1.57256 17.0412 1.91752 17.2169C2.30969 17.4167 2.82307 17.4167 3.84984 17.4167H4.39984C5.4266 17.4167 5.93998 17.4167 6.33215 17.2169C6.67712 17.0412 6.95758 16.7607 7.13335 16.4157C7.33317 16.0236 7.33317 15.5102 7.33317 14.4834V3.85008C7.33317 2.82332 7.33317 2.30994 7.13335 1.91777C6.95758 1.5728 6.67712 1.29234 6.33215 1.11657C5.93998 0.916748 5.4266 0.916748 4.39984 0.916748Z" stroke="#D6D3D1" stroke-width="1.83333" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M14.4832 0.916748H13.9332C12.9064 0.916748 12.393 0.916748 12.0009 1.11657C11.6559 1.29234 11.3754 1.5728 11.1997 1.91777C10.9998 2.30994 10.9998 2.82332 10.9998 3.85008V14.4834C10.9998 15.5102 10.9998 16.0236 11.1997 16.4157C11.3754 16.7607 11.6559 17.0412 12.0009 17.2169C12.393 17.4167 12.9064 17.4167 13.9332 17.4167H14.4832C15.5099 17.4167 16.0233 17.4167 16.4155 17.2169C16.7605 17.0412 17.0409 16.7607 17.2167 16.4157C17.4165 16.0236 17.4165 15.5102 17.4165 14.4834V3.85008C17.4165 2.82332 17.4165 2.30994 17.2167 1.91777C17.0409 1.5728 16.7605 1.29234 16.4155 1.11657C16.0233 0.916748 15.5099 0.916748 14.4832 0.916748Z" stroke="#D6D3D1" stroke-width="1.83333" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                </Tooltip>

                <Tooltip content="View List">
                <button className={`cal-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14.4832 7.33342C15.5099 7.33342 16.0233 7.33342 16.4155 7.13359C16.7604 6.95783 17.0409 6.67736 17.2167 6.3324C17.4165 5.94023 17.4165 5.42684 17.4165 4.40008V3.85008C17.4165 2.82332 17.4165 2.30994 17.2167 1.91777C17.0409 1.5728 16.7605 1.29234 16.4155 1.11657C16.0233 0.916749 15.5099 0.916749 14.4832 0.916749L3.84984 0.916748C2.82307 0.916748 2.30969 0.916748 1.91752 1.11657C1.57256 1.29234 1.29209 1.5728 1.11633 1.91777C0.916504 2.30994 0.916504 2.82332 0.916504 3.85008L0.916504 4.40008C0.916504 5.42684 0.916504 5.94023 1.11633 6.3324C1.29209 6.67736 1.57256 6.95783 1.91752 7.13359C2.30969 7.33341 2.82307 7.33341 3.84984 7.33341L14.4832 7.33342Z" stroke="#D6D3D1" stroke-width="1.83333" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M14.4832 17.4167C15.5099 17.4167 16.0233 17.4167 16.4155 17.2169C16.7604 17.0412 17.0409 16.7607 17.2167 16.4157C17.4165 16.0236 17.4165 15.5102 17.4165 14.4834V13.9334C17.4165 12.9067 17.4165 12.3933 17.2167 12.0011C17.0409 11.6561 16.7605 11.3757 16.4155 11.1999C16.0233 11.0001 15.5099 11.0001 14.4832 11.0001L3.84984 11.0001C2.82307 11.0001 2.30969 11.0001 1.91752 11.1999C1.57256 11.3757 1.29209 11.6561 1.11633 12.0011C0.916504 12.3933 0.916504 12.9067 0.916504 13.9334L0.916504 14.4834C0.916504 15.5102 0.916504 16.0236 1.11633 16.4157C1.29209 16.7607 1.57256 17.0412 1.91752 17.2169C2.30969 17.4167 2.82307 17.4167 3.84984 17.4167H14.4832Z" stroke="#D6D3D1" stroke-width="1.83333" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                </Tooltip>
              </div>
            )}
            <button className="btn btn-primary btn-create" onClick={() => openBookingModal()}>
              Tạo lịch <FiPlus />
            </button>
          </div>
        </div>
        <div className="cal-toolbar-mobile">
          {/* Row 1: Date navigation + Create button */}
          <div className="cal-toolbar-row1">
            <div className="cal-toolbar-middle">
              <Tooltip content="Ngày trước">
                <button className="btn-icon" aria-label="Ngày trước" onClick={goPrev}><FiChevronLeft /></button>
              </Tooltip>
              <span className="cal-week-label">
                {formatDateVietnamese(currentDate)}
              </span>
              <Tooltip content="Ngày sau">
                <button className="btn-icon" aria-label="Ngày sau" onClick={goNext}><FiChevronRight /></button>
              </Tooltip>
            </div>
            <div className="cal-toolbar-actions">
              <Tooltip content={isToday ? "Đang xem lịch hôm nay" : "Trở về hôm nay"}>
                <button 
                  className={`btn btn-sm btn-ghost btn-today${isToday ? ' active' : ''}`} 
                  onClick={goToday}
                >
                  Hôm nay
                </button>
              </Tooltip>
              <button className="btn btn-primary btn-create" onClick={() => openBookingModal()}>
                <span className="btn-create-label">Tạo lịch</span> <FiPlus />
              </button>
            </div>
          </div>

          {/* Row 2: Branch selector + View toggle */}
          <div className="cal-toolbar-row2">
            <div className="cal-toolbar-left">
              <BranchDropdown
                branches={branches}
                value={filterBranch}
                onChange={setFilterBranch}
              />
            </div>
            <div className="cal-view-toggle">
              <Tooltip content="View Lịch">
                <button className={`cal-view-btn${viewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')}>
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4.39984 0.916748H3.84984C2.82307 0.916748 2.30969 0.916748 1.91752 1.11657C1.57256 1.29234 1.29209 1.5728 1.11633 1.91777C0.916504 2.30994 0.916504 2.82332 0.916504 3.85008V14.4834C0.916504 15.5102 0.916504 16.0236 1.11633 16.4157C1.29209 16.7607 1.57256 17.0412 1.91752 17.2169C2.30969 17.4167 2.82307 17.4167 3.84984 17.4167H4.39984C5.4266 17.4167 5.93998 17.4167 6.33215 17.2169C6.67712 17.0412 6.95758 16.7607 7.13335 16.4157C7.33317 16.0236 7.33317 15.5102 7.33317 14.4834V3.85008C7.33317 2.82332 7.33317 2.30994 7.13335 1.91777C6.95758 1.5728 6.67712 1.29234 6.33215 1.11657C5.93998 0.916748 5.4266 0.916748 4.39984 0.916748Z" stroke="#D6D3D1" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14.4832 0.916748H13.9332C12.9064 0.916748 12.393 0.916748 12.0009 1.11657C11.6559 1.29234 11.3754 1.5728 11.1997 1.91777C10.9998 2.30994 10.9998 2.82332 10.9998 3.85008V14.4834C10.9998 15.5102 10.9998 16.0236 11.1997 16.4157C11.3754 16.7607 11.6559 17.0412 12.0009 17.2169C12.393 17.4167 12.9064 17.4167 13.9332 17.4167H14.4832C15.5099 17.4167 16.0233 17.4167 16.4155 17.2169C16.7605 17.0412 17.0409 16.7607 17.2167 16.4157C17.4165 16.0236 17.4165 15.5102 17.4165 14.4834V3.85008C17.4165 2.82332 17.4165 2.30994 17.2167 1.91777C17.0409 1.5728 16.7605 1.29234 16.4155 1.11657C16.0233 0.916748 15.5099 0.916748 14.4832 0.916748Z" stroke="#D6D3D1" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </Tooltip>
              
              <Tooltip content="View List">
                <button className={`cal-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14.4832 7.33342C15.5099 7.33342 16.0233 7.33342 16.4155 7.13359C16.7604 6.95783 17.0409 6.67736 17.2167 6.3324C17.4165 5.94023 17.4165 5.42684 17.4165 4.40008V3.85008C17.4165 2.82332 17.4165 2.30994 17.2167 1.91777C17.0409 1.5728 16.7605 1.29234 16.4155 1.11657C16.0233 0.916749 15.5099 0.916749 14.4832 0.916749L3.84984 0.916748C2.82307 0.916748 2.30969 0.916748 1.91752 1.11657C1.57256 1.29234 1.29209 1.5728 1.11633 1.91777C0.916504 2.30994 0.916504 2.82332 0.916504 3.85008L0.916504 4.40008C0.916504 5.42684 0.916504 5.94023 1.11633 6.3324C1.29209 6.67736 1.57256 6.95783 1.91752 7.13359C2.30969 7.33341 2.82307 7.33341 3.84984 7.33341L14.4832 7.33342Z" stroke="#D6D3D1" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14.4832 17.4167C15.5099 17.4167 16.0233 17.4167 16.4155 17.2169C16.7604 17.0412 17.0409 16.7607 17.2167 16.4157C17.4165 16.0236 17.4165 15.5102 17.4165 14.4834V13.9334C17.4165 12.9067 17.4165 12.3933 17.2167 12.0011C17.0409 11.6561 16.7605 11.3757 16.4155 11.1999C16.0233 11.0001 15.5099 11.0001 14.4832 11.0001L3.84984 11.0001C2.82307 11.0001 2.30969 11.0001 1.91752 11.1999C1.57256 11.3757 1.29209 11.6561 1.11633 12.0011C0.916504 12.3933 0.916504 12.9067 0.916504 13.9334L0.916504 14.4834C0.916504 15.5102 0.916504 16.0236 1.11633 16.4157C1.29209 16.7607 1.57256 17.0412 1.91752 17.2169C2.30969 17.4167 2.82307 17.4167 3.84984 17.4167H14.4832Z" stroke="#D6D3D1" strokeWidth="1.83333" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
        {viewMode === 'calendar' && (
          <div className="cal-staff-header-wrap">
            {/* Header row */}
            <div className="cal-staff-header"></div>
            {loading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <div key={`skeleton-hdr-${idx}`} className="cal-staff-header available">
                  <div className="skeleton-shimmer-light" style={{ width: '80px', height: '16px', borderRadius: '4px' }} />
                </div>
              ))
            ) : (
              employees.map(emp => {
                const empSched = employeeSchedules.find(s => s.employee_id === emp.id);
                const isAvailable = empSched && !empSched.is_day_off;
                return (
                  <div
                    key={emp.id}
                    className={`cal-staff-header ${isAvailable ? 'available' : 'unavailable'}`}
                  >
                    {emp.name}
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
