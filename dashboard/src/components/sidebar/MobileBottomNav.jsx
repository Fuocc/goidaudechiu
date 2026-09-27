import { NavLink } from 'react-router-dom';
import { CalendarIcon, BellIcon, SmileIcon, UsersIcon } from './SidebarIcons';

// Thanh điều hướng dưới cùng trên mobile: Lịch hẹn, Thông báo, Nhân viên/Khách, Menu
// Component trình bày: state + handler vẫn nằm ở Sidebar.jsx, truyền vào qua props.
export default function MobileBottomNav({
  isAdmin,
  mobileOpen,
  panelOpen,
  toggleMobile,
  togglePanel,
  unreadCount
}) {
  return (
    <>
      <nav className="mobile-bottom-nav">
        <div className="mobile-bottom-nav-inner">
          {/* Lịch hẹn */}
          <NavLink
            to="/"
            end
            className={({ isActive }) => `mobile-nav-item${isActive && !panelOpen && !mobileOpen ? ' active' : ''}`}
          >
            <CalendarIcon />
            <span>Lịch hẹn</span>
          </NavLink>

          {/* Thông báo */}
          <button
            className={`mobile-nav-item${panelOpen ? ' active' : ''}`}
            onClick={(e) => togglePanel(e)}
            style={{ position: 'relative' }}
          >
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <BellIcon />
              {unreadCount > 0 && (
                <span className="notif-badge" style={{ top: -2, right: -4, minWidth: 8, height: 8 }}></span>
              )}
            </div>
            <span>Thông báo</span>
          </button>

          {/* Nhân viên — chỉ admin/dev; staff thấy "Khách hàng" (trang staff được phép dùng) */}
          {isAdmin ? (
            <NavLink
              to="/employees"
              className={({ isActive }) => `mobile-nav-item${isActive && !panelOpen && !mobileOpen ? ' active' : ''}`}
            >
              <UsersIcon />
              <span>Nhân viên</span>
            </NavLink>
          ) : (
            <NavLink
              to="/customers"
              className={({ isActive }) => `mobile-nav-item${isActive && !panelOpen && !mobileOpen ? ' active' : ''}`}
            >
              <SmileIcon />
              <span>Khách</span>
            </NavLink>
          )}

          {/* Menu — no notif-badge */}
          <button
            className={`mobile-nav-item${mobileOpen ? ' active' : ''}`}
            onClick={toggleMobile}
          >
            <svg className="sidebar-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </>
  );
}
