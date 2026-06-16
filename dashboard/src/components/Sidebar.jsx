import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import { supabase } from '../supabaseClient';
import { useWebPush } from '../hooks/useWebPush';
import { savePreferenceToDB } from '../idbHelper';
import '../styles/sidebar.css';
import logo from '../assets/logo.svg';
import geminiLogo from '../assets/gemini-logo.svg';
import AIChatPanel from './AIChatPanel';
import { getDashboardNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification } from '../api';

// ---- Custom Inline SVG Icons with stroke="currentColor" ----
const CalendarIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
);

const BellIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
);

const SmileIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
    <line x1="9" y1="9" x2="9.01" y2="9"></line>
    <line x1="15" y1="9" x2="15.01" y2="9"></line>
  </svg>
);

const TagIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
    <line x1="7" y1="7" x2="7.01" y2="7"></line>
  </svg>
);

const StoreIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1z" />
    <path d="M3 7l1.5-4h15l1.5 4" />
    <path d="M9 13v-3" />
    <path d="M15 13v-3" />
    <path d="M3 13h18" />
  </svg>
);

const UsersIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
  </svg>
);

const UserIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const ClockIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const SettingsIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const LogOutIcon = () => (
  <svg className="sidebar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </svg>
);

const SparkleIcon = () => (
  <svg className="sparkle-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0Z" fill="url(#sparkleGradient)" />
    <defs>
      <linearGradient id="sparkleGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFC72C" />
        <stop offset="30%" stopColor="#FF5A5F" />
        <stop offset="65%" stopColor="#8A3FFC" />
        <stop offset="100%" stopColor="#00C2FF" />
      </linearGradient>
    </defs>
  </svg>
);

function Sidebar({ user, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutMenuOpen, setLogoutMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const [aiChatOpen, setAiChatOpen] = useState(false);

  useEffect(() => {
    const handleToggle = () => {
      setAiChatOpen(prev => !prev);
    };
    window.addEventListener('toggle-ai-chat', handleToggle);
    return () => window.removeEventListener('toggle-ai-chat', handleToggle);
  }, []);

  const profileRef = useRef(null);
  const popoverRef = useRef(null);
  const role = user?.publicMetadata?.role || 'admin';

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
  const { isSupported, isSubscribed, loading, subscribe, unsubscribe } = useWebPush();

  // Auto-subscribe if permission is already granted
  useEffect(() => {
    if (isSupported && !isSubscribed && !loading) {
      if (Notification.permission === 'granted') {
        subscribe().catch(() => { });
      }
    }
  }, [isSupported, isSubscribed, loading, subscribe]);

  // Interaction-driven auto-prompt for default permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const autoRequest = async () => {
          // Remove the listeners immediately after the first interaction trigger
          document.removeEventListener('click', autoRequest);
          document.removeEventListener('keydown', autoRequest);

          try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              console.log("Notification permission granted via auto-prompt.");
              if (isSupported && !isSubscribed && !loading) {
                subscribe().catch(() => { });
              }
            }
          } catch (err) {
            console.error("Auto request notification failed:", err);
          }
        };

        document.addEventListener('click', autoRequest);
        document.addEventListener('keydown', autoRequest);

        return () => {
          document.removeEventListener('click', autoRequest);
          document.removeEventListener('keydown', autoRequest);
        };
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
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'unread' | 'CN 1' | 'CN 2'
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

  // Sync user metadata preferences to IndexedDB for Service Worker
  useEffect(() => {
    if (user?.unsafeMetadata?.notifications) {
      savePreferenceToDB(user.unsafeMetadata.notifications);
    }
  }, [user?.unsafeMetadata?.notifications]);

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
        }).filter(n => {
          const prefs = user?.unsafeMetadata?.notifications || { branch1: true, branch2: true };
          if (n.branchId === 1 && !prefs.branch1) return false;
          if (n.branchId === 2 && !prefs.branch2) return false;
          return true;
        });
        setNotifications(mapped);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoadingNotifs(false);
    }
  }, [user?.unsafeMetadata?.notifications]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const [collapsedGroups, setCollapsedGroups] = useState({});

  const isGroupExpanded = (groupKey, currentCollapsed = collapsedGroups) => {
    if (currentCollapsed[groupKey] !== undefined) {
      return currentCollapsed[groupKey];
    }
    return true; // Expand date groups by default for cleaner Day Dividers
  };

  const toggleGroup = (groupKey) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupKey]: !isGroupExpanded(groupKey, prev)
    }));
  };

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
    if (empNormalized.startsWith('thủy') || empNormalized.includes('thuy')) {
      return { letter: 'T', bg: '#ff9f43', color: '#ffffff' }; // Cam cho Thủy
    }
    if (empNormalized.startsWith('hannie') || empNormalized.includes('hannie')) {
      return { letter: 'H', bg: '#fd79a8', color: '#ffffff' }; // Hồng cho Hannie
    }
    if (empNormalized.startsWith('phụng') || empNormalized.includes('phung')) {
      return { letter: 'P', bg: '#9b59b6', color: '#ffffff' }; // Tím cho Phụng
    }

    const nameToUse = customerName || 'Khách';
    const cleanName = nameToUse.trim().replace(/^(Anh|Chị|Chị|Em|C|A)\s+/i, '');
    const letter = cleanName ? cleanName.charAt(0).toUpperCase() : '👤';

    const colors = [
      { bg: '#386665', color: '#ffffff' }, // Y Oi Teal
      { bg: '#edd3a9', color: '#603813' }, // Y Oi Accent Gold
      { bg: '#10ac84', color: '#ffffff' },
      { bg: '#2e86de', color: '#ffffff' },
      { bg: '#ee5253', color: '#ffffff' },
      { bg: '#ff9f43', color: '#ffffff' }
    ];
    const colorIndex = letter.charCodeAt(0) % colors.length;
    return { letter, ...colors[colorIndex] };
  };

  const getRelativeDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const bookingDate = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const bookingTime = bookingDate.getTime();
    const todayTime = today.getTime();
    const tomorrowTime = tomorrow.getTime();
    const yesterdayTime = yesterday.getTime();

    if (bookingTime === todayTime) {
      return 'hôm nay';
    } else if (bookingTime === tomorrowTime) {
      return 'ngày mai';
    } else if (bookingTime === yesterdayTime) {
      return 'hôm qua';
    } else {
      const day = String(bookingDate.getDate()).padStart(2, '0');
      const month = String(bookingDate.getMonth() + 1).padStart(2, '0');
      return `ngày ${day}/${month}`;
    }
  };

  const getNotifMessage = (n) => {
    if (n.customerName) {
      const dateLabel = getRelativeDateLabel(n.bookingDate);
      const datePhrase = dateLabel ? ` vào ${dateLabel}` : '';
      return `${n.customerName} vừa đặt lịch ${n.serviceName} tại ${n.branchName} lúc ${n.startTime?.substring(0, 5)}${datePhrase}`;
    }
    return n.message;
  };

  const getGroupedNotifications = () => {
    const groups = {};

    // Filter notifications based on activeFilter
    const filtered = notifications.filter(n => {
      if (activeFilter === 'unread') return !n.read;
      if (activeFilter === 'CN 1') return n.branchName?.includes('CN 1') || n.branchName?.includes('CN1');
      if (activeFilter === 'CN 2') return n.branchName?.includes('CN 2') || n.branchName?.includes('CN2');
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
    const isHold = booking.status === 'pending' && booking.internal_note?.includes('GIỮ CHỖ TẠM THỜI');
    if (isHold) return;

    // ----- Notification Preference Check -----
    const prefs = user?.unsafeMetadata?.notifications || { branch1: true, branch2: true };

    // Branch 1 is typically ID 1 or the first branch, Branch 2 is ID 2.
    // Ensure we respect the switch settings:
    if (booking.branch_id === 1 && !prefs.branch1) return;
    if (booking.branch_id === 2 && !prefs.branch2) return;
    // ------------------------------------------

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
  }, [fetchNotifications]);


  const handleNotifClick = (n) => {
    markAsRead(n.id);
    closePanel();

    if (n.bookingId && n.bookingDate) {
      sessionStorage.setItem('goto_booking', JSON.stringify({
        bookingId: n.bookingId,
        bookingDate: n.bookingDate,
        branchId: n.branchId
      }));

      const event = new CustomEvent('goto-booking', {
        detail: {
          bookingId: n.bookingId,
          bookingDate: n.bookingDate,
          branchId: n.branchId
        }
      });
      window.dispatchEvent(event);

      if (location.pathname !== '/') {
        navigate('/');
      }
    }
  };

  useEffect(() => {
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

          }
        }
      )
      .subscribe();

    const API_BASE = import.meta.env.VITE_API_BASE;
    const sseUrl = API_BASE.replace(/\/api$/, '') + '/api/events';

    let eventSource;
    let reconnectTimer;

    const connect = () => {
      eventSource = new EventSource(sseUrl);

      eventSource.addEventListener('booking.created', (e) => {
        const booking = JSON.parse(e.data);
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

  const sectionsToRender = role === 'admin' ? adminSections : staffSections;

  // Mobile Bottom Navigation: max 4 items
  const bottomNavItems = role === 'admin'
    ? [
      { path: '/', label: 'Lịch hẹn', icon: CalendarIcon },
      { path: '/customers', label: 'Khách', icon: SmileIcon },
      { path: '/schedules', label: 'Lịch NV', icon: ClockIcon },
      { path: '/employees', label: 'Nhân viên', icon: UsersIcon },
    ]
    : [
      { path: '/', label: 'Lịch hẹn', icon: CalendarIcon },
      { path: '/customers', label: 'Khách', icon: SmileIcon },
    ];

  const roleLabel = role === 'admin' ? 'Quản trị viên' : 'Nhân viên';

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
          <button
            className={`sidebar-header-gemini tooltip-trigger${aiChatOpen ? ' active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              closePanel();
              window.dispatchEvent(new CustomEvent('toggle-ai-chat'));
            }}
          >
            <img src={geminiLogo} alt="AI" className="sparkle-icon" />
            <span className="tooltip-text tooltip-bottom">
              {aiChatOpen ? "Tắt trợ lí AI" : "Mở trợ lí AI"}
            </span>
          </button>
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
          {role === 'admin' && (
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

          {/* Nhân viên */}
          <NavLink
            to="/employees"
            className={({ isActive }) => `mobile-nav-item${isActive && !panelOpen && !mobileOpen ? ' active' : ''}`}
          >
            <UsersIcon />
            <span>Nhân viên</span>
          </NavLink>

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

      {/* Notifications Slide-over Sheet */}
      {shouldRenderPanel && (
        <div className={`notif-panel-container ${panelOpen ? 'open' : isClosing ? 'closing' : ''}`}>
          <div className="notif-panel" ref={panelRef} onClick={e => e.stopPropagation()}>
            <div className="notif-panel-header">
              <div className="notif-header-top">
                <span className="notif-title">Hoạt động</span>
                <button className="btn-mark-all-read-top" onClick={markAllAsRead}>
                  <svg width="18" height="17" viewBox="0 0 18 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.75 7.41667L8.25 9.91667L16.5833 1.58333M11.5833 0.75H4.75C3.34987 0.75 2.6498 0.75 2.11502 1.02248C1.64462 1.26217 1.26217 1.64462 1.02248 2.11502C0.75 2.6498 0.75 3.34987 0.75 4.75V11.75C0.75 13.1501 0.75 13.8502 1.02248 14.385C1.26217 14.8554 1.64462 15.2378 2.11502 15.4775C2.6498 15.75 3.34987 15.75 4.75 15.75H11.75C13.1501 15.75 13.8502 15.75 14.385 15.4775C14.8554 15.2378 15.2378 14.8554 15.4775 14.385C15.75 13.8502 15.75 13.1501 15.75 11.75V8.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg> Đã đọc hết

                </button>
                <button className="btn-close-notif-top" onClick={closePanel}>
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
                <button
                  className={`notif-filter-tag${activeFilter === 'CN 1' ? ' active' : ''}`}
                  onClick={() => setActiveFilter('CN 1')}
                >
                  CN 1
                </button>
                <button
                  className={`notif-filter-tag${activeFilter === 'CN 2' ? ' active' : ''}`}
                  onClick={() => setActiveFilter('CN 2')}
                >
                  CN 2
                </button>
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
                  <h4 className="notif-empty-title">Dỏi nghen...</h4>
                  <p className="notif-empty-subtitle">Bạn đã xem hết hoạt động rồi!</p>
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
                        const branchNameClean = n.branchName?.includes('CN 1') || n.branchName?.includes('CN1') ? 'CN 1' : 'CN 2';
                        const staffText = n.employeeName ? ` (${n.employeeName})` : '';

                        let descText = `${actionType} ${bookingTime} — ${guestsCount} người — ${branchNameClean}${staffText}`;
                        let notesText = n.notes;

                        // Special parsing for Rescheduled slots ("Dời lịch: 6:00 PM — từ 3:00 PM")
                        const reschedulePattern = /(dời lịch|đổi lịch):\s*\d{1,2}:\d{2}\s*(?:PM|AM)?\s*—\s*từ\s*\d{1,2}:\d{2}\s*(?:PM|AM)?/i;
                        const hasRescheduleNote = reschedulePattern.test(n.notes || '') || reschedulePattern.test(n.internal_note || '') || reschedulePattern.test(n.title || '');

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
                                    <button
                                      className="btn-card-action tooltip-trigger"
                                      onClick={(e) => { e.stopPropagation(); toggleReadStatus(n.id, n.read); }}
                                    >
                                      {n.read ? (
                                          // Read
                                          <svg width="16" height="16" viewBox="0 0 18 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M8.63114 0.73913C9.03964 0.73913 9.37079 1.07005 9.37079 1.47826C9.37079 1.88647 9.03964 2.21739 8.63114 2.21739H4.68443C3.98183 2.21739 3.49922 2.21765 3.1252 2.24819C2.75989 2.27802 2.56323 2.33274 2.42119 2.40506C2.09663 2.57038 1.83253 2.83429 1.6671 3.15863C1.59473 3.30056 1.53997 3.49709 1.51011 3.86215C1.47956 4.23591 1.4793 4.71817 1.4793 5.42029V12.3188C1.4793 13.021 1.47956 13.5032 1.51011 13.877C1.53997 14.242 1.59473 14.4386 1.6671 14.5805C1.83253 14.9048 2.09663 15.1687 2.42119 15.3341C2.56323 15.4064 2.75989 15.4611 3.1252 15.4909C3.49922 15.5215 3.98183 15.5217 4.68443 15.5217H11.5878C12.2904 15.5217 12.773 15.5215 13.147 15.4909C13.5123 15.4611 13.709 15.4064 13.851 15.3341C14.1756 15.1688 14.4397 14.9048 14.6051 14.5805C14.6775 14.4386 14.7323 14.242 14.7621 13.877C14.7927 13.5032 14.7929 13.021 14.7929 12.3188L14.7968 9.85411C14.7974 9.44596 15.129 9.11541 15.5374 9.11594C15.9458 9.11658 16.2766 9.44791 16.2761 9.85603L16.2722 12.3198C16.2722 12.9971 16.2732 13.5496 16.2366 13.9973C16.1993 14.4538 16.119 14.8662 15.9226 15.2513C15.6154 15.8538 15.1252 16.3436 14.5223 16.6506C14.137 16.8468 13.7243 16.9271 13.2674 16.9644C12.8192 17.001 12.266 17 11.5878 17H4.68443C4.00624 17 3.45305 17.001 3.00482 16.9644C2.54796 16.9271 2.13526 16.8468 1.74992 16.6506C1.14699 16.3436 0.656861 15.8538 0.349601 15.2513C0.153261 14.8662 0.0729647 14.4538 0.0356366 13.9973C-0.000985338 13.5494 2.58887e-06 12.9966 2.58887e-06 12.3188V5.42029C2.58887e-06 4.74257 -0.000985338 4.18977 0.0356366 3.74185C0.0729647 3.28531 0.153261 2.8729 0.349601 2.48783C0.656861 1.88532 1.14699 1.39553 1.74992 1.08848C2.13526 0.892282 2.54796 0.812042 3.00482 0.77474C3.45305 0.738143 4.00624 0.73913 4.68443 0.73913H8.63114Z" fill="currentColor" />
                                            <path fillRule="evenodd" clipRule="evenodd" d="M14.0552 0C16.2339 0 18 1.76491 18 3.94203C18 6.11915 16.2339 7.88406 14.0552 7.88406C11.8766 7.88406 10.1104 6.11915 10.1104 3.94203C10.1104 1.76491 11.8766 1.52383e-06 14.0552 0ZM14.0552 1.47826C12.6936 1.47826 11.5897 2.58133 11.5897 3.94203C11.5897 5.30273 12.6936 6.40579 14.0552 6.4058C15.4169 6.4058 16.5207 5.30273 16.5207 3.94203C16.5207 2.58133 15.4169 1.47826 14.0552 1.47826Z" fill="currentColor" />
                                          </svg>
                                        ) : (
                                          // Unread
                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 18 17"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m5.75 7.42 2.5 2.5 8.33-8.34m-5-.83H4.75c-1.4 0-2.1 0-2.63.27a2.5 2.5 0 0 0-1.1 1.1C.75 2.65.75 3.35.75 4.75v7c0 1.4 0 2.1.27 2.64q.37.72 1.1 1.09c.53.27 1.23.27 2.63.27h7c1.4 0 2.1 0 2.64-.27a2.5 2.5 0 0 0 1.09-1.1c.27-.53.27-1.23.27-2.63v-3.5"/></svg>
                                        )}
                                      <span className="tooltip-text">
                                        {n.read ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}
                                      </span>
                                    </button>

                                    <button
                                      className="btn-card-action tooltip-trigger"
                                      onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M5.75 0.75H10.75M0.75 3.25H15.75M14.0833 3.25L13.4989 12.0161C13.4112 13.3313 13.3674 13.9889 13.0833 14.4875C12.8333 14.9265 12.456 15.2794 12.0014 15.4997C11.485 15.75 10.8259 15.75 9.50779 15.75H6.99221C5.67409 15.75 5.01503 15.75 4.49861 15.4997C4.04396 15.2794 3.66674 14.9265 3.41665 14.4875C3.13259 13.9889 3.08875 13.3313 3.00107 12.0161L2.41667 3.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                                      </svg>

                                      <span className="tooltip-text">Xóa</span>
                                    </button>
                                  </div>
                                  <span className="notif-card-time">
                                    {formatRelativeTime(n.createdAt)}
                                  </span>
                                  <span className="notif-guests-badge-top">
                                    {guestsCount}
                                  </span>
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
          window.dispatchEvent(new CustomEvent('toggle-ai-chat'));
        }}
        title="Trò chuyện AI (ChatLGBT)"
      >
        <img src={geminiLogo} alt="AI Chat" />
      </button>
    </>
  );
}

export default Sidebar;
