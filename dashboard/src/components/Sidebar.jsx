import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { subscribeRealtime, REALTIME_RECONNECTED } from '../realtime';
import { useWebPush } from '../hooks/useWebPush';
import { getMutedBranchIds, getCurrentPushEndpoint } from '../utils/notificationPrefs';
import '../styles/sidebar.css';
import logo from '../assets/logo.svg';
import { Tooltip } from '../components/ui/tooltip';
import geminiLogo from '../assets/gemini-logo.svg';
import AIChatPanel from './AIChatPanel';
import { getDashboardNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification, updateNotificationPreferences } from '../api';
import { isHoldBooking } from '../utils/booking';
import { shortBranchName } from '../utils/format';
import { clickableProps } from '../utils/a11y';
import { useAppUI } from '../context/AppUIContext';
import { CalendarIcon, BellIcon, SmileIcon, TagIcon, StoreIcon, UsersIcon, UserIcon, ClockIcon, ExternalLinkIcon, SettingsIcon, LogOutIcon } from './sidebar/SidebarIcons';
import MobileBottomNav from './sidebar/MobileBottomNav';
import NotificationPanel from './sidebar/NotificationPanel';

function Sidebar({ user, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutMenuOpen, setLogoutMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const [aiChatOpen, setAiChatOpen] = useState(false);
  const toggleAiChat = () => setAiChatOpen(prev => !prev);
  const { gotoBooking } = useAppUI();

  const profileRef = useRef(null);
  const popoverRef = useRef(null);
  const role = user?.publicMetadata?.role;
  const isAdmin = role === 'admin' || role === 'dev';

  // ---- Click Outside Handler for Floating Logout Popover ----
  useEffect(() => {
    function handleClickOutside(event) {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        if (popoverRef.current && popoverRef.current.contains(event.target)) {
          return;
        }
        setLogoutMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ---- VAPID Web Push Notification Hook ----
  const { isSupported, isSubscribed, loading: pushLoading, subscribe } = useWebPush();
  const autoSubscribeTriedRef = useRef(false);

  // Tự động đăng ký push đúng 1 lần mỗi lần mở app (không lặp lại khi thất bại).
  // - Đã cấp quyền: đăng ký ngay.
  // - Chưa hỏi quyền: đợi thao tác đầu tiên của người dùng (trình duyệt bắt buộc) rồi mới hỏi.
  useEffect(() => {
    if (!isSupported || pushLoading || isSubscribed || autoSubscribeTriedRef.current) return;

    const runSilentSubscribe = async () => {
      autoSubscribeTriedRef.current = true;
      const result = await subscribe({ silent: true });
      if (!result.ok && result.error !== 'cooldown' && result.error !== 'Quyền thông báo bị từ chối.') {
        // Chỉ báo 1 lần mỗi phiên, không dùng alert chặn màn hình
        try {
          if (!sessionStorage.getItem('yoi_push_warned')) {
            sessionStorage.setItem('yoi_push_warned', '1');
            toast.info('Trình duyệt này chưa bật được thông báo đẩy. Hãy thử Chrome/Safari bản mới hoặc kiểm tra cài đặt thông báo.', { autoClose: 6000 });
          }
        } catch (e) { /* ignore */ }
      }
    };

    if (Notification.permission === 'granted') {
      runSilentSubscribe();
      return;
    }

    if (Notification.permission === 'default') {
      const onFirstInteraction = () => {
        document.removeEventListener('click', onFirstInteraction);
        document.removeEventListener('keydown', onFirstInteraction);
        runSilentSubscribe();
      };
      document.addEventListener('click', onFirstInteraction);
      document.addEventListener('keydown', onFirstInteraction);
      return () => {
        document.removeEventListener('click', onFirstInteraction);
        document.removeEventListener('keydown', onFirstInteraction);
      };
    }
    // permission === 'denied': không làm gì
  }, [isSupported, pushLoading, isSubscribed, subscribe]);

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
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'unread' | 'branch:<tên ngắn chi nhánh>'
  const [shouldRenderPanel, setShouldRenderPanel] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = useRef(null);

  const closePanel = useCallback(() => {
    setIsClosing(true);
    setPanelOpen(false);
    setTimeout(() => {
      setShouldRenderPanel(false);
      setIsClosing(false);
    }, 150);
  }, []);

  const togglePanel = useCallback((e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (panelOpen) {
      closePanel();
    } else {
      setShouldRenderPanel(true);
      setTimeout(() => {
        setPanelOpen(true);
      }, 10);
    }
  }, [panelOpen, closePanel]);

  // Click outside handler
  useEffect(() => {
    if (!panelOpen) return;

    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        closePanel();
      }
    }

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [panelOpen, closePanel]);

  // Sync to localStorage as offline/instant-load cache
  useEffect(() => {
    localStorage.setItem('yoi_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Chi nhánh người dùng đã tắt thông báo (Clerk unsafeMetadata). Dùng chuỗi làm key để deps ổn định.
  const mutedKey = getMutedBranchIds(user).join(',');
  const mutedBranchIds = useMemo(() => (mutedKey ? mutedKey.split(',') : []), [mutedKey]);

  // Đồng bộ cài đặt lên server để lọc push khi gửi (thiết bị mới đăng ký / tự sửa khi lần lưu trước lỗi).
  // Chỉ chạy khi đã có user (tránh ghi đè bằng danh sách rỗng lúc user chưa tải xong) và thiết bị đã đăng ký push.
  useEffect(() => {
    if (!user?.id || !isSubscribed) return;
    let cancelled = false;
    (async () => {
      const endpoint = await getCurrentPushEndpoint();
      if (cancelled) return;
      updateNotificationPreferences({ muted_branch_ids: mutedBranchIds, endpoint })
        .catch(err => console.warn('[push] Không đồng bộ được cài đặt thông báo:', err.message));
    })();
    return () => { cancelled = true; };
  }, [user?.id, isSubscribed, mutedBranchIds]);

  const fetchNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    try {
      const data = await getDashboardNotifications();
      if (data) {
        const mapped = data.map(n => {
          const bk = n.bookings || {};
          const customerName = bk.temporary_name || bk.customers?.name || n.customer_name || 'Khách Lạ';
          const serviceName = bk.services?.name || n.service_name || 'Dịch vụ';
          const branchName = bk.branches?.name || n.branch_name || 'Chi nhánh';
          const employeeName = bk.employees?.name || '';
          const numGuests = bk.num_guests || 1;
          const startTime = bk.start_time || n.start_time || '';
          const notes = bk.notes || '';
          return {
            id: n.id,
            bookingId: n.booking_id,
            bookingDate: bk.booking_date || n.booking_date,
            branchId: bk.branch_id || n.branch_id || null,
            title: n.title,
            customerName,
            serviceName,
            branchName,
            employeeName,
            numGuests,
            startTime,
            notes,
            time: new Date(n.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            createdAt: n.created_at,
            read: n.read
          };
        }).filter(n => !(n.branchId && mutedBranchIds.includes(n.branchId)));
        setNotifications(mapped);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoadingNotifs(false);
    }
  }, [mutedBranchIds]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Nút lọc theo chi nhánh: sinh từ các chi nhánh đang có thông báo ("CN 1", "CN 2", ...)
  const branchFilterLabels = useMemo(() => {
    const labels = new Set(notifications.map(n => shortBranchName(n.branchName)).filter(Boolean));
    return [...labels].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [notifications]);

  const getGroupedNotifications = () => {
    const groups = {};

    // Filter notifications based on activeFilter ('all' | 'unread' | 'branch:<tên ngắn chi nhánh>')
    const filtered = notifications.filter(n => {
      if (activeFilter === 'unread') return !n.read;
      if (activeFilter.startsWith('branch:')) return shortBranchName(n.branchName) === activeFilter.slice('branch:'.length);
      return true;
    });

    filtered.forEach(n => {
      let dateKey = 'Lịch sử';
      if (n.createdAt) {
        const d = new Date(n.createdAt);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (d.toDateString() === today.toDateString()) {
          dateKey = 'Hôm nay';
        } else if (d.toDateString() === yesterday.toDateString()) {
          dateKey = 'Hôm qua';
        } else {
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const year = d.getFullYear();
          dateKey = `Ngày ${day}/${month}/${year}`;
        }
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(n);
    });

    return groups;
  };

  const toggleReadStatus = async (id, currentRead) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: !currentRead } : n));
    try {
      await markNotificationRead(id, !currentRead);
    } catch (err) {
      console.error('Error toggling read status:', err);
    }
  };

  const markAsRead = async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    try {
      await markNotificationRead(id, true);
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const markAllAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await markAllNotificationsRead();
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const deleteNotif = async (id) => {
    const originalNotifications = [...notifications];
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      await deleteNotification(id);
    } catch (err) {
      console.error('Error deleting notification:', err);
      setNotifications(originalNotifications);
    }
  };


  // Dedup set: prevent same booking from being processed by both Supabase Realtime & SSE
  const processedBookingsRef = useRef(new Set());

  const handleNewBooking = useCallback((booking) => {
    // 1) Filter out temporary holds ("Khách đang đặt")
    if (isHoldBooking(booking)) return;

    // Chi nhánh đã tắt thông báo trong Cài đặt cá nhân → không kêu chuông
    if (booking.branch_id && mutedBranchIds.includes(booking.branch_id)) return;

    // Dedup: skip if this booking was already processed recently
    const bookingId = booking.id;
    if (bookingId && processedBookingsRef.current.has(bookingId)) {
      return;
    }
    if (bookingId) {
      processedBookingsRef.current.add(bookingId);
      // Auto-cleanup after 10 seconds to prevent memory leak
      setTimeout(() => processedBookingsRef.current.delete(bookingId), 10000);
    }

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

    }

    // Fetch the notifications list from our Service Role backend API after 1.5 seconds,
    // which automatically grabs the rich booking details (guest counts, therapist names, notes).
    setTimeout(() => {
      fetchNotifications();
    }, 1500);
  }, [fetchNotifications, mutedBranchIds]);


  const handleNotifClick = (n) => {
    markAsRead(n.id);
    closePanel();

    if (n.bookingId && n.bookingDate) {
      // Trang Lịch hẹn đọc target từ context (kể cả khi được mở sau, lúc đang ở trang khác)
      gotoBooking({
        bookingId: n.bookingId,
        bookingDate: n.bookingDate,
        branchId: n.branchId,
        branchName: n.branchName
      });

      if (location.pathname !== '/') {
        navigate('/');
      }
    }
  };

  // Lịch mới → phát chuông + tải lại thông báo. Dùng kết nối SSE chung đã xác thực
  // (bỏ Supabase Realtime: dashboard không còn truy cập thẳng database bằng anon key).
  useEffect(() => {
    return subscribeRealtime({
      'booking.created': (booking) => { if (booking) handleNewBooking(booking); },
      // Kết nối lại sau khi đứt → tải lại danh sách thông báo (có thể đã lỡ lịch mới)
      [REALTIME_RECONNECTED]: () => { fetchNotifications(); }
    });
  }, [handleNewBooking, fetchNotifications]);

  // ---- Dynamic Sections Definition based on Mockup ----
  const adminSections = [
    {
      title: 'TRANG CHỦ',
      items: [
        { path: '/', label: 'Lịch hẹn', icon: CalendarIcon },
        {
          label: 'Thông báo',
          icon: BellIcon,
          onClick: (e) => { togglePanel(e); }
        }
      ]
    },
    {
      title: 'QUẢN LÍ',
      items: [
        { path: '/customers', label: 'Khách hàng', icon: SmileIcon },
        { path: '/services', label: 'Dịch vụ', icon: TagIcon }
      ]
    },
    {
      title: 'DOANH NGHIỆP',
      items: [
        { path: '/branches', label: 'Chi nhánh', icon: StoreIcon },
        { path: '/employees', label: 'Nhân viên', icon: UsersIcon },
        { path: '/schedules', label: 'Lịch NV', icon: ClockIcon },
        { path: '/share-link', label: 'Share link', icon: ExternalLinkIcon }
      ]
    }
  ];

  const staffSections = [
    {
      title: 'TRANG CHỦ',
      items: [
        { path: '/', label: 'Lịch hẹn', icon: CalendarIcon },
        {
          label: 'Thông báo',
          icon: BellIcon,
          onClick: (e) => { togglePanel(e); }
        }
      ]
    },
    {
      title: 'QUẢN LÍ',
      items: [
        { path: '/customers', label: 'Khách hàng', icon: SmileIcon }
      ]
    }
  ];

  const sectionsToRender = isAdmin ? adminSections : staffSections;

  const roleLabel = role === 'dev' ? 'Developer' : role === 'admin' ? 'Quản trị viên' : 'Nhân viên';

  // Close sidebar and notif panel on route change (mobile and desktop)
  useEffect(() => {
    setMobileOpen(false);
    closePanel();
  }, [location.pathname, closePanel]);

  // Lock body scroll when mobile sidebar is open, or AI Chat is open on mobile
  useEffect(() => {
    const isMobile = window.innerWidth <= 768;
    if (mobileOpen || (aiChatOpen && isMobile)) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen, aiChatOpen]);

  const toggleMobile = useCallback(() => {
    setMobileOpen(prev => !prev);
    closePanel();
  }, [closePanel]);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const userDisplayName = user?.fullName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Admin';
  const firstLetter = userDisplayName[0].toUpperCase();

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`sidebar-overlay${mobileOpen ? ' visible' : ''}`}
        onClick={closeMobile}
      />

      {/* Desktop / Tablet / Mobile Sidebar */}
      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        {/* Header with Logo and Right-aligned Gemini */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img src={logo} alt="Logo" />
          </div>
          <Tooltip content={aiChatOpen ? "Tắt trợ lí AI" : "Mở trợ lí AI"}>
            <button
              className={`sidebar-header-gemini${aiChatOpen ? ' active' : ''}`}
              aria-label={aiChatOpen ? "Tắt trợ lí AI" : "Mở trợ lí AI"}
              onClick={(e) => {
                e.preventDefault();
                closePanel();
                toggleAiChat();
              }}
            >
              <img src={geminiLogo} alt="AI"/>
            </button>
          </Tooltip>
        </div>

        {/* Dynamic Categorized Sidebar Links */}
        <nav className="sidebar-nav">
          {sectionsToRender.map(section => (
            <div className="sidebar-section" key={section.title}>
              <div className="sidebar-section-title">{section.title}</div>
              <div className="sidebar-section-items">
                {section.items.map(item => {
                  if (item.onClick) {
                    return (
                      <button
                        key={item.label}
                        className={`sidebar-link${panelOpen ? ' active' : ''}`}
                        onClick={item.onClick}
                        title={item.label}
                      >
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <item.icon />
                          {item.label === 'Thông báo' && unreadCount > 0 && (
                            <div className="notif-badge"></div>
                          )}
                        </div>
                        <span className="sidebar-label">{item.label}</span>
                      </button>
                    );
                  }
                  return (
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
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer Area with Dynamic Text circular Avatar, Float Logout and bottom Settings Link */}
        <div className="sidebar-footer">

          {/* Floating Absolute Logout Popover above profile card */}
          {logoutMenuOpen && (
            <div className="logout-popover" ref={popoverRef}>
              {/* User Info Header */}
              <div className="logout-popover-header">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="Avatar" className="sidebar-user-avatar avatar-lg" style={{ objectFit: 'cover' }} />
                ) : (
                  <div className="sidebar-user-avatar avatar-lg">
                    {firstLetter}
                  </div>
                )}
                <div className="logout-popover-header-info">
                  <div className="logout-popover-header-name">{userDisplayName}</div>
                  <div className="logout-popover-header-role">{roleLabel}</div>
                </div>
              </div>

              {/* Menu Actions */}
              <div className="logout-popover-menu">
                <NavLink
                  to="/user-settings"
                  className="logout-popover-btn"
                  style={{ textDecoration: 'none' }}
                  onClick={() => setLogoutMenuOpen(false)}
                >
                  <UserIcon />
                  <span>Thông tin</span>
                </NavLink>
                <NavLink
                  to="/user-settings"
                  className="logout-popover-btn"
                  style={{ textDecoration: 'none' }}
                  onClick={() => setLogoutMenuOpen(false)}
                >
                  <BellIcon />
                  <span>Thông báo</span>
                </NavLink>
              </div>

              <div className="logout-popover-bottom">
                <button className="logout-popover-btn" onClick={onLogout}>
                  <LogOutIcon />
                  <span>Đăng xuất</span>
                </button>
              </div>

            </div>
          )}

          {/* Dynamic Circular User Profile (first letter of Name, toggles float Logout popover) */}
          <div
            className="sidebar-user"
            onClick={() => setLogoutMenuOpen(prev => !prev)}
            {...clickableProps(() => setLogoutMenuOpen(prev => !prev))}
            aria-label="Tài khoản"
            ref={profileRef}
          >
            {user?.imageUrl ? (
              <img src={user.imageUrl} alt="Avatar" className="sidebar-user-avatar avatar-sm" style={{ objectFit: 'cover' }} />
            ) : (
              <div className="sidebar-user-avatar avatar-sm">
                {firstLetter}
              </div>
            )}
            <div className="sidebar-user-name">
              {userDisplayName}
            </div>
          </div>

          {/* Cài đặt Link positioned at the very bottom */}
          {isAdmin && (
            <NavLink
              to="/settings"
              className={({ isActive }) => `sidebar-link sidebar-settings-link${isActive ? ' active' : ''}`}
              title="Cài đặt"
            >
              <SettingsIcon />
              <span className="sidebar-label">Cài đặt</span>
            </NavLink>
          )}

        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        isAdmin={isAdmin}
        mobileOpen={mobileOpen}
        panelOpen={panelOpen}
        toggleMobile={toggleMobile}
        togglePanel={togglePanel}
        unreadCount={unreadCount}
      />

      {/* Notifications Slide-over Sheet */}
      <NotificationPanel
        activeFilter={activeFilter}
        branchFilterLabels={branchFilterLabels}
        closePanel={closePanel}
        deleteNotif={deleteNotif}
        getGroupedNotifications={getGroupedNotifications}
        handleNotifClick={handleNotifClick}
        isClosing={isClosing}
        loadingNotifs={loadingNotifs}
        markAllAsRead={markAllAsRead}
        panelOpen={panelOpen}
        panelRef={panelRef}
        setActiveFilter={setActiveFilter}
        setPanelOpen={setPanelOpen}
        shouldRenderPanel={shouldRenderPanel}
        toggleReadStatus={toggleReadStatus}
      />

      {/* AI Chat Slide-over Sheet (Floating like Notifications) */}
      <div
        className={`ai-chat-panel-floating${aiChatOpen ? ' visible' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <AIChatPanel
          onClose={() => setAiChatOpen(false)}
          currentBranchId=""
        />
      </div>
      {/* Floating AI Chat Button (Mobile/Tablet only) */}
      <button
        className="float-gemini-btn"
        onClick={(e) => {
          e.preventDefault();
          closePanel();
          toggleAiChat();
        }}
        title="Trợ lý AI (Ý Chatbot)"
        aria-label="Mở trợ lý AI"
      >
        <img src={geminiLogo} alt="AI Chat" />
      </button>
    </>
  );
}

export default Sidebar;
