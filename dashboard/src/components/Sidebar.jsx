import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { FiUsers, FiUserCheck, FiScissors, FiCalendar, FiMapPin, FiLogOut, FiClock, FiSettings, FiMenu, FiX, FiBell } from 'react-icons/fi';
import { Avatar, Circle, Float } from "@chakra-ui/react"
import { supabase } from '../supabaseClient';
import { useWebPush } from '../hooks/useWebPush';
import '../styles/sidebar.css';


function Sidebar({ user, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const role = user?.publicMetadata?.role || 'admin';

  // ---- VAPID Web Push Notification Hook ----
  const { isSupported, isSubscribed, loading, subscribe, unsubscribe } = useWebPush();

  // Tự động bật đẩy trình duyệt ngầm dưới nền khi trang tải
  useEffect(() => {
    if (isSupported && !isSubscribed && !loading) {
      if (Notification.permission !== 'denied') {
        subscribe().catch(err => console.warn("Tự động đăng ký Web Push thất bại:", err));
      }
    }
  }, [isSupported, isSubscribed, loading, subscribe]);

  // ---- Notifications State & Real-time Listeners ----
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('yoi_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('yoi_notifications', JSON.stringify(notifications));
  }, [notifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  // Dedup set: prevent same booking from being processed by both Supabase Realtime & SSE
  const processedBookingsRef = useRef(new Set());

  const handleNewBooking = useCallback((booking) => {
    // 1) Filter out temporary holds ("Khách đang đặt")
    const isHold = booking.status === 'pending' && booking.internal_note?.includes('[Khách đang đặt]');
    if (isHold) return;

    // Dedup: skip if this booking was already processed recently
    const bookingId = booking.id;
    if (bookingId && processedBookingsRef.current.has(bookingId)) {
      console.log('🔕 Skipping duplicate notification for booking:', bookingId);
      return;
    }
    if (bookingId) {
      processedBookingsRef.current.add(bookingId);
      // Auto-cleanup after 10 seconds to prevent memory leak
      setTimeout(() => processedBookingsRef.current.delete(bookingId), 10000);
    }

    // 2) Parse customer, service and branch details
    const customerName = booking.customers?.name || booking.customer_name || 'Khách Lạ';
    const serviceName = booking.services?.name || booking.service_name || 'Dịch vụ';
    const branchName = booking.branches?.name || 'Chi nhánh';
    const startTime = booking.start_time || '';

    // Play a gentle soft bell sound
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, context.currentTime); // D5
      osc.frequency.setValueAtTime(880.00, context.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, context.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.35);
    } catch (e) {
      console.warn("Sound blocked by browser user gesture policies", e);
    }

    // Helper to format booking date relatively
    const getRelativeDateLabel = (dateStr) => {
      if (!dateStr) return '';
      const bookingDate = new Date(dateStr + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const bookingTime = bookingDate.getTime();
      const todayTime = today.getTime();
      const tomorrowTime = tomorrow.getTime();

      if (bookingTime === todayTime) {
        return 'hôm nay';
      } else if (bookingTime === tomorrowTime) {
        return 'ngày mai';
      } else {
        const day = String(bookingDate.getDate()).padStart(2, '0');
        const month = String(bookingDate.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}`;
      }
    };

    const relativeDate = getRelativeDateLabel(booking.booking_date);
    const datePhrase = relativeDate ? ` vào ${relativeDate}` : '';

    // 3) Create clean notification card
    const newNotif = {
      id: `${booking.id || Date.now()}-${Math.random()}`,
      bookingId: booking.id,
      bookingDate: booking.booking_date,
      title: 'Lịch hẹn mới! 🎉',
      message: `${customerName} vừa đặt lịch ${serviceName} tại ${branchName} lúc ${startTime.substring(0, 5)}${datePhrase}`,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      read: false
    };

    // NOTE: Do NOT show native `new Notification()` here.
    // VAPID Web Push via sw.js already handles OS-level push notifications.
    // Creating a native Notification here would cause duplicate notifications.

    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
  }, []);

  // Request browser permission for native push notifications on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, []);

  const handleNotifClick = (n) => {
    markAsRead(n.id);
    setPanelOpen(false);

    if (n.bookingId && n.bookingDate) {
      // Save details to sessionStorage
      sessionStorage.setItem('goto_booking', JSON.stringify({
        bookingId: n.bookingId,
        bookingDate: n.bookingDate
      }));

      // Dispatch custom window event
      const event = new CustomEvent('goto-booking', {
        detail: {
          bookingId: n.bookingId,
          bookingDate: n.bookingDate
        }
      });
      window.dispatchEvent(event);

      // Navigate to the list/calendar view if we aren't already there
      if (location.pathname !== '/') {
        navigate('/');
      }
    }
  };

  useEffect(() => {
    // 1) Supabase Realtime for cross-port guest booking creations
    const channel = supabase
      .channel('realtime-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bookings'
        },
        async (payload) => {
          try {
            // Fetch relations
            const { data: booking, error } = await supabase
              .from('bookings')
              .select(`
                *,
                customers(name, phone),
                services(name, color),
                branches(name)
              `)
              .eq('id', payload.new.id)
              .single();

            if (!error && booking) {
              handleNewBooking(booking);
            }
          } catch (err) {
            console.error("Error fetching notification details:", err);
          }
        }
      )
      .subscribe();

    // 2) SSE Connection for local actions
    const API_BASE = import.meta.env.VITE_API_BASE;
    const sseUrl = API_BASE.replace(/\/api$/, '') + '/api/events';

    let eventSource;
    let reconnectTimer;

    const connect = () => {
      eventSource = new EventSource(sseUrl);

      eventSource.addEventListener('booking.created', (e) => {
        const booking = JSON.parse(e.data);
        console.log('🔔 Notification SSE: New booking', booking);
        handleNewBooking(booking);
      });

      eventSource.onerror = () => {
        eventSource.close();
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      supabase.removeChannel(channel);
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [handleNewBooking]);

  // Định nghĩa menu cho từng quyền
  const adminItems = [
    { path: '/', label: 'Lịch hẹn', icon: FiCalendar },
    { path: '/schedules', label: 'Lịch NV', icon: FiClock },
    { path: '/customers', label: 'Khách hàng', icon: FiUsers },
    { path: '/employees', label: 'Nhân viên', icon: FiUserCheck },
    { path: '/services', label: 'Dịch vụ', icon: FiScissors },
    { path: '/branches', label: 'Chi nhánh', icon: FiMapPin },
    { path: '/settings', label: 'Cài đặt', icon: FiSettings },
  ];

  const staffItems = [
    { path: '/', label: 'Lịch hẹn', icon: FiCalendar },
    { path: '/customers', label: 'Khách hàng', icon: FiUsers },
  ];

  // Chọn menu hiển thị dựa trên role
  const itemsToRender = role === 'admin' ? adminItems : staffItems;

  // Bottom nav: show max 4 items + More for mobile
  const bottomNavItems = role === 'admin'
    ? [
      { path: '/', label: 'Lịch hẹn', icon: FiCalendar },
      { path: '/customers', label: 'Khách', icon: FiUsers },
      { path: '/schedules', label: 'Lịch NV', icon: FiClock },
      { path: '/employees', label: 'Nhân viên', icon: FiUserCheck },
    ]
    : staffItems;

  // Hiển thị vai trò người dùng động
  const roleLabel = role === 'admin' ? 'Quản trị viên' : 'Nhân viên';

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const toggleMobile = useCallback(() => {
    setMobileOpen(prev => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`sidebar-overlay${mobileOpen ? ' visible' : ''}`}
        onClick={closeMobile}
      />

      {/* Desktop / Tablet / Mobile Sidebar */}
      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-logo">
          <h1>Ý Ơi <span>Dashboard</span></h1>
        </div>

        <nav className="sidebar-nav">
          {itemsToRender.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              title={item.label}
            >
              <item.icon />
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}

          {/* Notification Sidebar Item */}
          <button
            className={`sidebar-link${panelOpen ? ' active' : ''}`}
            onClick={(e) => { e.preventDefault(); setPanelOpen(prev => !prev); }}
            title="Thông báo"
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <FiBell className={unreadCount > 0 ? "bell-ringing" : ""} />
              {unreadCount > 0 && (
                <span className="notif-badge">{unreadCount}</span>
              )}
            </div>
            <span className="sidebar-label" style={{ marginLeft: 0 }}>Thông báo</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <Avatar.Root colorPalette="grey" variant="subtle">
              {user?.imageUrl && <Avatar.Image src={user.imageUrl} style={{ borderRadius: '50%', objectFit: 'cover' }} />}
              <Avatar.Fallback name={user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Admin'} />
              <Float placement="bottom-end" offsetX="1" offsetY="1">
                <Circle
                  bg="green.500"
                  size="8px"
                  outline="0.2em solid"
                  outlineColor="bg"
                />
              </Float>
            </Avatar.Root>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">
                {user?.fullName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Admin'}
              </div>
              <div className="sidebar-user-role">{roleLabel}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={onLogout}>
            <FiLogOut style={{ marginRight: 8, verticalAlign: 'middle', display: 'inline' }} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        <div className="mobile-bottom-nav-inner">
          {bottomNavItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
            >
              <item.icon />
              <span>{item.label}</span>
            </NavLink>
          ))}
          {role === 'admin' && (
            <button
              className={`mobile-nav-item${mobileOpen ? ' active' : ''}`}
              onClick={toggleMobile}
              style={{ position: 'relative' }}
            >
              <FiMenu />
              {unreadCount > 0 && (
                <span className="notif-badge" style={{ top: 2, right: 12, minWidth: 10, height: 10, border: '1px solid white' }}></span>
              )}
              <span>Thêm</span>
            </button>
          )}

          {role === 'staff' && (
            <button
              className={`mobile-nav-item${mobileOpen ? ' active' : ''}`}
              onClick={toggleMobile}
              style={{ position: 'relative' }}
            >
              <FiMenu />
              {unreadCount > 0 && (
                <span className="notif-badge" style={{ top: 2, right: 12, minWidth: 10, height: 10, border: '1px solid white' }}></span>
              )}
              <span>Thêm</span>
            </button>
          )}
        </div>
      </nav>

      {/* Notifications Slide-over Sheet */}
      {panelOpen && (
        <div className="notif-panel-overlay" onClick={() => setPanelOpen(false)}>
          <div className="notif-panel" onClick={e => e.stopPropagation()}>
            <div className="notif-panel-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Thông báo ({unreadCount} chưa đọc)</h3>
                <button className="btn-close-notif" onClick={() => setPanelOpen(false)}>
                  <FiX size={16} />
                </button>
              </div>
              <div className="notif-panel-actions">
                {unreadCount > 0 && (
                  <button className="btn-mark-all" onClick={markAllAsRead}>
                    Đánh dấu đã đọc tất cả
                  </button>
                )}
              </div>
            </div>

            <div className="notif-panel-body">
              {notifications.length === 0 ? (
                <div className="notif-empty">
                  <FiBell size={32} />
                  <p>Không có thông báo nào</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`notif-item${!n.read ? ' unread' : ''}`}
                    onClick={() => handleNotifClick(n)}
                  >
                    <div className="notif-item-header">
                      <span className="notif-item-title">{n.title}</span>
                      <span className="notif-item-time">{n.time}</span>
                    </div>
                    <p className="notif-item-msg">{n.message}</p>
                    {!n.read && <span className="notif-unread-dot" />}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
