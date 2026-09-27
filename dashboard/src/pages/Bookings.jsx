import { useState, useEffect, useMemo, useRef } from 'react';
import { FiPlus, FiChevronLeft, FiChevronRight, FiCalendar, FiMoreVertical, FiX, FiAlertTriangle } from 'react-icons/fi';
import { toast } from 'react-toastify';
import TimePickerInput from '../components/TimePickerInput';

import {
  getBookingsRange, createBooking, updateBooking, deleteBooking,
  getBranches, getServices, getEmployees, getCustomers, getEmployeeSchedules,
  getSettings
} from '../api';

import userIcon from '../assets/user-icon.svg';
import shopIcon from '../assets/shop-icon.svg';
import clockIcon from '../assets/clock-icon.svg';
import noteIcon from '../assets/note-icon.svg';

import { Tooltip } from '../components/ui/tooltip';
import { DatePicker, parseDate } from "@chakra-ui/react"
import { subscribeRealtime, REALTIME_RECONNECTED } from '../realtime';
import BranchDropdown from '../components/BranchDropdown';
import { getInitial } from '../utils/format';
import { isHoldBooking, isSpamWarningBooking, bookingStatusLabel } from '../utils/booking';
import { describeError } from '../utils/notify';
import { clickableProps } from '../utils/a11y';
import { useConfirm } from '../components/ConfirmDialog';
import {
  CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR, WEEKDAY_MIN_OPEN_MINUTES, LOGICAL_DAY_CUTOFF,
  WALK_IN_CUSTOMER_NAME, PLACEHOLDER_SERVICE_NAME
} from '../config/business';
import '../styles/bookings.css';
// ---- Helpers ----
const OPEN_HOUR = CALENDAR_OPEN_HOUR;
const CLOSE_HOUR = CALENDAR_CLOSE_HOUR;
const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeToMinutes(t) {
  if (!t) return 0;
  // Handle AM/PM if present
  let timeStr = t.toLowerCase();
  let isPM = timeStr.includes('pm');
  let isAM = timeStr.includes('am');

  // Clean string to get HH:mm
  let cleanTime = timeStr.replace(/am|pm/g, '').trim();
  let [h, m] = cleanTime.split(':').map(Number);

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return (h || 0) * 60 + (m || 0);
}

const STATUS_COLORS = {
  confirmed: { bg: '#e6f4ec', border: '#0d8a3f', text: '#0d8a3f' },
  pending: { bg: '#fef3e2', border: '#e67e22', text: '#e67e22' },
  completed: { bg: '#eff6ff', border: '#2563eb', text: '#2563eb' }
};

const normalize = (str) => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const WALK_IN_NORMALIZED = normalize(WALK_IN_CUSTOMER_NAME);       // 'khach la'
const PLACEHOLDER_NORMALIZED = normalize(PLACEHOLDER_SERVICE_NAME); // 'giu cho'


const getBookingColor = (booking) => {
  if (booking.status === 'pending' && booking.internal_note) {
    return STATUS_COLORS.pending.bg;
  }

  const name = normalize(booking.temporary_name || booking.customers?.name || '');
  if (name === WALK_IN_NORMALIZED) {
    return '#F1F1EF'; // Grey
  }

  return booking.services?.color || '#EDF4EB';
};

const formatPrice = (v) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v || 0);
const formatTime = (t) => {
  if (!t) return '-';
  const cleanTime = t.substring(0, 5);
  const [hStr, mStr] = cleanTime.split(':');
  const h = parseInt(hStr);
  if (isNaN(h)) return cleanTime;
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2)}:${mStr} ${period}`;
};


const normalizeName = (name) => {
  if (!name) return '';
  let cleaned = name.trim();
  if (cleaned.toLowerCase().startsWith('c ')) {
    cleaned = 'Chị ' + cleaned.substring(2);
  } else if (cleaned.toLowerCase().startsWith('a ')) {
    cleaned = 'Anh ' + cleaned.substring(2);
  }
  return cleaned.split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const getLogicalDate = () => {
  const d = new Date();
  const { hour, minute } = LOGICAL_DAY_CUTOFF;
  if (d.getHours() > hour || (d.getHours() === hour && d.getMinutes() >= minute)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
};

const formatDateVietnamese = (date) => {
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dayName = days[date.getDay()];
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();

  return (
    <>
      {dayName}, {d}/{m} <span style={{ color: '#A8A29E' }}>{y}</span>
    </>
  );
};

function Bookings() {
  const confirmDialog = useConfirm();
  // Responsive: detect mobile for PWA
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mobile mở mặc định ở list view, desktop ở calendar view (vẫn đổi được bằng nút toggle)
  const [viewMode, setViewMode] = useState(() => (window.innerWidth <= 768 ? 'list' : 'calendar')); // 'calendar' | 'list'

  const [currentDate, setCurrentDate] = useState(getLogicalDate());

  const [bookings, setBookings] = useState([]);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]); // All active employees of filtered branch
  const [filterBranch, setFilterBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const loadBookingsRef = useRef(null);

  useEffect(() => {
    const handleRefresh = () => {
      // Gọi bản loadBookings MỚI NHẤT qua ref (effect này không chạy lại khi đổi ngày/chi nhánh → tránh tải nhầm ngày cũ).
      // loadBookings tải lại cả lịch hẹn + nhân viên (AI có thể đổi tour trực).
      loadBookingsRef.current?.();
    };

    window.addEventListener('refresh-bookings', handleRefresh);
    return () => {
      window.removeEventListener('refresh-bookings', handleRefresh);
    };
  }, []);

  // Booking modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailEdit, setDetailEdit] = useState(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailCustomerView, setDetailCustomerView] = useState('selected'); // 'selected', 'searching', 'creating'
  const [bookForm, setBookForm] = useState({
    branch_id: '', service_id: '', num_guests: 1,
    customer_name: '', customer_phone: '', customer_email: '',
    booking_date: '', start_time: '', notes: ''
  });
  const [selectedService, setSelectedService] = useState(null);
  const [searchSuggestions, setSearchSuggestions] = useState({ type: null, data: [], loading: false });
  const [customerView, setCustomerView] = useState('default'); // 'default', 'searching', 'selected', 'creating'
  const [showCalendar, setShowCalendar] = useState(false);
  const [detailTab, setDetailTab] = useState('schedule'); // 'schedule' or 'customer'
  const [employeeSchedules, setEmployeeSchedules] = useState([]);
  const [showDetailMore, setShowDetailMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // Drag-and-drop reorder state
  const [cardDrag, setCardDrag] = useState(null); // { booking, startCol, startTop }
  const [dragConfirm, setDragConfirm] = useState(null); // { booking, fromStaff, fromTime, toStaff, toTime, toStaffId, newDate, newStart, newEnd }
  // Drag-to-create state
  const [dragInfo, setDragInfo] = useState(null); // { startY, currentY, staffId, staffName, columnEl }
  const [hoverInfo, setHoverInfo] = useState(null); // { staffId, y, colLeft, colWidth }
  const [sysSettings, setSysSettings] = useState({});
  const calendarRef = useRef(null);
  const moreMenuRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const searchSeqRef = useRef(0);
  const gridRef = useRef(null);
  const nowLineRef = useRef(null);

  const notify = (msg) => {
    toast.success(msg || "Cập nhật thành công", {
      position: "bottom-right"
    });
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Keep refs of current values to avoid stale closures in event listeners
  const currentDateRef = useRef(currentDate);
  const filterBranchRef = useRef(filterBranch);

  useEffect(() => {
    currentDateRef.current = currentDate;
  }, [currentDate]);

  useEffect(() => {
    filterBranchRef.current = filterBranch;
  }, [filterBranch]);

  // Chống race condition: chỉ nhận kết quả của lần gọi mới nhất (bấm đổi ngày liên tục → response về lệch thứ tự)
  const loadSeqRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const [loadError, setLoadError] = useState(null);

  // Ultra-fast helper to refresh ONLY bookings without refetching employees/settings/schedules.
  // This drastically reduces API calls from 4 to 1 per real-time event.
  const refreshBookingsOnly = async () => {
    const branchId = filterBranchRef.current;
    const dateStr = toDateStr(currentDateRef.current);
    if (!branchId) return;

    const seq = ++refreshSeqRef.current;
    try {
      const bookingsData = await getBookingsRange(dateStr, dateStr, branchId);
      // Bỏ kết quả nếu đã có lần làm mới sau, hoặc người dùng vừa chuyển ngày/chi nhánh trong lúc chờ
      if (seq !== refreshSeqRef.current || branchId !== filterBranchRef.current || dateStr !== toDateStr(currentDateRef.current)) return;
      setBookings(bookingsData.filter(b => b.status !== 'cancelled'));
    } catch (err) {
      // Lỗi khi làm mới nền: giữ nguyên dữ liệu đang hiển thị, không làm phiền người dùng
      console.warn('[bookings] Làm mới realtime lỗi:', err?.message);
    }
  };

  useEffect(() => {
    loadBookings();
  }, [currentDate, filterBranch]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // ---- Live Booking Updates (SSE dùng chung, đã xác thực) ----
  // 1 lệnh AI tạo nhóm 3 khách sinh ra nhiều sự kiện liên tiếp → gộp lại thành 1 lần tải (debounce 300ms)
  // thay vì bắn nhiều request cùng lúc (response về lệch thứ tự có thể hiển thị dữ liệu cũ).
  useEffect(() => {
    let debounceTimer = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refreshBookingsOnly();
      }, 300);
    };

    const unsubscribe = subscribeRealtime({
      'booking.created': scheduleRefresh,
      'booking.updated': scheduleRefresh,
      'booking.deleted': scheduleRefresh,
      'booking.hold': scheduleRefresh,
      'booking.hold_released': scheduleRefresh,
      // Kết nối realtime bị đứt rồi nối lại → các sự kiện trong lúc đứt đã lỡ → tải lại lịch
      [REALTIME_RECONNECTED]: scheduleRefresh
    });

    return () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []); // Connect once on mount

  // Effect to handle navigating/scrolling to a specific booking from a notification
  useEffect(() => {
    const handleGotoBooking = (detail) => {
      if (!detail || !detail.bookingId || !detail.bookingDate) return;

      // 1. Switch to the correct branch if different
      let targetBranchId = detail.branchId;
      if (!targetBranchId && detail.branchName && branches.length > 0) {
        const isCN1 = detail.branchName.includes('CN 1') || detail.branchName.includes('CN1');
        const isCN2 = detail.branchName.includes('CN 2') || detail.branchName.includes('CN2');
        const matched = branches.find(b => {
          const name = b.name || '';
          if (isCN1) return name.includes('CN 1') || name.includes('CN1');
          if (isCN2) return name.includes('CN 2') || name.includes('CN2');
          return name.toLowerCase().includes(detail.branchName.toLowerCase());
        });
        if (matched) {
          targetBranchId = matched.id;
        }
      }

      if (targetBranchId && targetBranchId !== filterBranchRef.current) {
        setFilterBranch(targetBranchId);
      }

      // 2. Change the date of the calendar grid
      const targetDate = new Date(detail.bookingDate + 'T00:00:00');
      setCurrentDate(targetDate);

      // 3. Wait for the state to update, the new date's bookings to load and the DOM to render
      // We can poll the DOM for the booking card element
      let attempts = 0;
      const interval = setInterval(() => {
        // Card gộp nhóm trên mobile chỉ mang id của lịch đầu → tìm thêm theo data-booking-ids
        const cardEl = document.getElementById(`booking-card-${detail.bookingId}`)
          || document.querySelector(`[data-booking-ids~="${detail.bookingId}"]`);
        if (cardEl) {
          clearInterval(interval);
          // Scroll to the card
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Add highlighting class
          cardEl.classList.add('highlight-appointment');

          // Remove highlight after 3 seconds
          setTimeout(() => {
            cardEl.classList.remove('highlight-appointment');
          }, 3000);
        }
        attempts++;
        if (attempts > 60) { // Timeout after 6 seconds (60 * 100ms)
          clearInterval(interval);
        }
      }, 100);
    };

    // Check sessionStorage on mount and when bookings are loaded
    const checkSessionStorage = () => {
      const stored = sessionStorage.getItem('goto_booking');
      if (stored) {
        try {
          const detail = JSON.parse(stored);
          sessionStorage.removeItem('goto_booking'); // Clear so we don't trigger again on subsequent renders
          handleGotoBooking(detail);
        } catch (e) {

        }
      }
    };

    // Listen to custom event
    const onGotoEvent = (e) => {
      handleGotoBooking(e.detail);
    };

    window.addEventListener('goto-booking', onGotoEvent);

    // We also want to check sessionStorage when bookings array changes (which means loading has finished)
    if (!loading && bookings.length > 0) {
      checkSessionStorage();
    }

    return () => {
      window.removeEventListener('goto-booking', onGotoEvent);
    };
  }, [loading, bookings, branches]);

  // --- Drag-to-create: global mousemove/mouseup ---
  useEffect(() => {
    if (!dragInfo) return;

    const handleMouseMove = (e) => {
      const colRect = dragInfo.columnEl.getBoundingClientRect();
      const rawY = e.clientY - colRect.top;
      const snappedY = Math.max(dragInfo.startY, Math.ceil(rawY / 25) * 25);
      setDragInfo(prev => prev ? { ...prev, currentY: snappedY } : null);
    };

    const handleMouseUp = () => {
      if (!dragInfo) return;
      const startTime = convertYToTime(dragInfo.startY);
      const endY = Math.max(dragInfo.startY + 25, dragInfo.currentY);
      const endTime = convertYToTime(endY);

      // Open modal with pre-populated times and staff
      const emp = employees.find(e => e.id === dragInfo.staffId);
      openBookingModal(toDateStr(currentDate), emp, startTime, endTime);
      setDragInfo(null);
      setHoverInfo(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragInfo, employees, currentDate]);

  // --- Card drag-and-drop reorder: global mousemove/mouseup ---
  useEffect(() => {
    if (!cardDrag) return;

    const handleMouseMove = (e) => {
      const cols = document.querySelectorAll('.cal-staff-column');
      let targetCol = null;
      for (const col of cols) {
        const rect = col.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          targetCol = col;
          break;
        }
      }
      if (targetCol) {
        const rect = targetCol.getBoundingClientRect();
        const rawY = e.clientY - rect.top;
        const snappedY = Math.floor(rawY / ROW_HEIGHT) * ROW_HEIGHT;
        setCardDrag(prev => prev ? { ...prev, currentCol: targetCol, currentTop: snappedY } : null);
      }
    };

    const handleMouseUp = () => {
      if (!cardDrag) return;
      const finalCol = cardDrag.currentCol || cardDrag.startCol;
      const finalTop = cardDrag.currentTop ?? cardDrag.startTop;
      const toStaffId = finalCol?.getAttribute('data-staff-id');
      const toStaffName = finalCol?.getAttribute('data-staff-name') || '';
      const fromStaffName = cardDrag.startCol?.getAttribute('data-staff-name') || '';

      const durationPx = cardDrag.heightPx;
      const newStart = convertYToTime(finalTop);
      const newEnd = convertYToTime(finalTop + durationPx);

      const origStartMin = timeToMinutes(cardDrag.booking.start_time);
      const origTop = (origStartMin - OPEN_HOUR * 60) / 60 * 100;
      const origStaffId = cardDrag.booking.employee_id || cardDrag.booking.employees?.id;

      // Check if actually moved
      if (Math.abs(finalTop - origTop) < 5 && toStaffId === origStaffId) {
        // Not moved — treat as click, open detail
        handleOpenDetail(cardDrag.booking);
      } else {
        // Show confirmation popup
        const fromStart = formatTime(cardDrag.booking.start_time);
        const fromEnd = formatTime(cardDrag.booking.end_time);
        setDragConfirm({
          booking: cardDrag.booking,
          fromStaff: fromStaffName,
          fromTime: `${fromStart} — ${fromEnd}`,
          toStaff: toStaffName,
          toTime: `${newStart} — ${newEnd}`,
          toStaffId,
          newStart,
          newEnd,
          newDate: toDateStr(currentDate)
        });
      }
      setCardDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [cardDrag, currentDate]);

  useEffect(() => {
    if (!showCalendar) return;
    const handleOutside = (e) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showCalendar]);

  useEffect(() => {
    if (!showDetailMore) return;
    const handleOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowDetailMore(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showDetailMore]);

  const loadInitialData = async () => {
    try {
      const [b, s, settingsData] = await Promise.all([getBranches(), getServices(), getSettings()]);
      setBranches(b);
      setServices(s);
      setSysSettings(settingsData || {});

      if (b.length > 0 && !filterBranch) {
        setFilterBranch(b[0].id);
      }
    } catch (err) {
      console.error('[bookings] Không tải được chi nhánh/dịch vụ:', err);
      setLoadError(describeError(err));
    }
  };

  const loadBookings = async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const dayStr = toDateStr(currentDate);
      // Fetch bookings, employees, schedules AND latest settings
      const [bookingsData, employeesData, schedulesData, settingsData] = await Promise.all([
        getBookingsRange(dayStr, dayStr, filterBranch || undefined),
        filterBranch ? getEmployees(filterBranch) : Promise.resolve([]),
        getEmployeeSchedules({ date_from: dayStr, date_to: dayStr }),
        getSettings()
      ]);

      if (seq !== loadSeqRef.current) return; // đã đổi ngày/chi nhánh → bỏ kết quả cũ

      setSysSettings(settingsData || {});
      setBookings(bookingsData.filter(b => b.status !== 'cancelled'));

      // Sort employees by tour order if exists
      const tourKey = `tour_order_${filterBranch}`;
      const savedOrder = settingsData ? settingsData[tourKey] : null;

      let sortedEmployees = employeesData.filter(e => e.is_active);
      if (savedOrder && Array.isArray(savedOrder)) {
        sortedEmployees.sort((a, b) => {
          const idxA = savedOrder.indexOf(a.id);
          const idxB = savedOrder.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
      }

      setEmployees(sortedEmployees);
      setEmployeeSchedules(schedulesData);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('[bookings] Không tải được lịch hẹn:', err);
      // Không để lại dữ liệu của ngày/chi nhánh trước dưới tiêu đề mới → xóa và hiện thông báo lỗi + nút thử lại
      setBookings([]);
      setEmployees([]);
      setEmployeeSchedules([]);
      setLoadError(describeError(err));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };
  loadBookingsRef.current = loadBookings;

  const handleRetryLoad = () => {
    if (branches.length === 0) loadInitialData();
    loadBookings();
  };

  // Navigation
  const goToday = () => {
    setCurrentDate(getLogicalDate());
  };
  useEffect(() => {
    if (toDateStr(currentDate) === todayStr) {
      const timer = setTimeout(() => {
        nowLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentDate]);
  const goPrev = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };
  const goNext = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const handleCancel = async (id) => {
    if (!(await confirmDialog({ message: 'Bạn có chắc muốn hủy lịch hẹn này?', confirmText: 'Hủy lịch', cancelText: 'Không', danger: true }))) return;
    try {
      await deleteBooking(id);
      notify('Đã hủy lịch hẹn thành công!');
      loadBookings();
      setDetailModal(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // --- Drag-to-create helpers ---
  const ROW_HEIGHT = 25; // pixels per 15-min slot
  const SNAP_MINUTES = 15;

  const convertYToTime = (y) => {
    const totalMins = (y / ROW_HEIGHT) * SNAP_MINUTES;
    const hours = Math.floor(totalMins / 60) + OPEN_HOUR;
    const mins = Math.floor(totalMins % 60);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const handleDragStart = (e, emp) => {
    // Don't start drag if clicking on a booking card
    if (e.target.closest('.cal-booking-card')) return;
    e.preventDefault();
    const col = e.currentTarget;
    const rect = col.getBoundingClientRect();
    const rawY = e.clientY - rect.top;
    const snappedY = Math.floor(rawY / ROW_HEIGHT) * ROW_HEIGHT;

    setDragInfo({
      startY: snappedY,
      currentY: snappedY + ROW_HEIGHT,
      staffId: emp.id,
      staffName: emp.name,
      columnEl: col
    });
  };

  const handleColumnHover = (e, emp) => {
    if (dragInfo || cardDrag) return; // Don't show ghost while dragging

    // Hide indicator when hovering over an existing booking card
    if (e.target.closest('.cal-booking-card')) {
      setHoverInfo(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const gridRect = gridRef.current?.getBoundingClientRect();
    if (!gridRect) return;
    const rawY = e.clientY - rect.top;
    const snappedY = Math.floor(rawY / ROW_HEIGHT) * ROW_HEIGHT;

    setHoverInfo({
      staffId: emp.id,
      y: snappedY,
      colLeft: rect.left - gridRect.left,
      colWidth: rect.width,
      time: convertYToTime(snappedY)
    });
  };

  // --- Card drag-and-drop: start ---
  const handleCardDragStart = (e, booking) => {
    e.stopPropagation();
    e.preventDefault();

    // Disable drag/click for guest slot holds
    if (isHoldBooking(booking)) return;

    const card = e.currentTarget;
    const col = card.closest('.cal-staff-column');
    if (!col) return;

    const startMin = timeToMinutes(booking.start_time);
    const endMin = timeToMinutes(booking.end_time);
    const top = (startMin - OPEN_HOUR * 60) / 60 * 100;
    const height = (endMin - startMin) / 60 * 100;

    setCardDrag({
      booking,
      startCol: col,
      startTop: top,
      currentCol: col,
      currentTop: top,
      heightPx: height
    });
  };

  // PUT lịch; nếu backend báo trùng giờ (409 BOOKING_CONFLICT) → hỏi "Vẫn lưu?" rồi gửi lại kèm allow_conflict.
  // Trả về lịch đã lưu, hoặc null nếu người dùng chọn không lưu.
  const updateBookingConfirmingConflict = async (id, payload) => {
    try {
      return await updateBooking(id, payload);
    } catch (err) {
      if (err?.status !== 409 || err.data?.code !== 'BOOKING_CONFLICT') throw err;
      const list = (err.data.conflicts || [])
        .map(c => `• ${c.customer_name}: ${formatTime(c.start_time)} - ${formatTime(c.end_time)}`)
        .join('\n');
      const keepSaving = await confirmDialog({
        title: 'Trùng lịch',
        message: `Nhân viên đã có lịch trùng giờ:\n${list}\n\nVẫn lưu?`,
        confirmText: 'Vẫn lưu',
        cancelText: 'Không lưu'
      });
      if (!keepSaving) return null;
      return await updateBooking(id, { ...payload, allow_conflict: true });
    }
  };

  const handleDragConfirm = async () => {
    if (!dragConfirm) return;
    try {
      const bk = dragConfirm.booking;
      const saved = await updateBookingConfirmingConflict(bk.id, {
        service_id: bk.service_id || bk.services?.id,
        branch_id: bk.branch_id || bk.branches?.id,
        employee_id: dragConfirm.toStaffId,
        start_time: dragConfirm.newStart,
        end_time: dragConfirm.newEnd,
        booking_date: dragConfirm.newDate
      });
      if (saved) {
        notify('Đã cập nhật lịch hẹn!');
        loadBookings();
      }
    } catch (err) {
      toast.error('Lỗi: ' + err.message);
    }
    setDragConfirm(null);
  };

  const handleDragCancel = () => {
    setDragConfirm(null);
  };

  // ---- Booking Modal Logic ----
  const openBookingModal = (preDate, preEmployee, preStartTime, preEndTime) => {
    setBookForm({
      branch_id: filterBranch || (branches[0]?.id || ''),
      service_id: '', num_guests: 1,
      customer_id: '',
      customer_name: '', customer_phone: '', customer_email: '',
      service_search: '',
      employee_search: preEmployee ? preEmployee.name : '',
      employee_id: preEmployee ? preEmployee.id : '',
      booking_date: preDate || toDateStr(new Date()),
      start_time: preStartTime || '--:--',
      end_time: preEndTime || '--:--',
      notes: ''
    });
    setCustomerView('default');
    setSelectedService(null);
    setModalOpen(true);
  };

  const handleDuplicate = () => {
    if (!detailModal || !detailEdit) return;

    // Copy data from detailEdit
    const service = services.find(s => s.id === detailEdit.service_id);
    // const employee = employees.find(e => e.id === detailEdit.employee_id);

    setBookForm({
      branch_id: detailEdit.branch_id,
      service_id: detailEdit.service_id,
      num_guests: 1,
      customer_id: detailEdit.customer_id,
      customer_name: detailEdit.customer_name,
      customer_phone: detailEdit.customer_phone,
      customer_email: detailEdit.customer_email,
      customer_habits: detailEdit.customer_habits,
      service_search: service?.name || '',
      employee_search: '',
      employee_id: detailEdit.employee_id,
      booking_date: detailEdit.booking_date,
      start_time: detailEdit.start_time,
      end_time: detailEdit.end_time,
      notes: detailEdit.notes || ''
    });

    setCustomerView('selected');

    setSelectedService(service);
    setDetailModal(null);
    setModalOpen(true);
    setShowDetailMore(false);
  };


  const calculateEndTime = (startTime, duration) => {
    if (!startTime || startTime === '--:--' || !duration) return '--:--';
    const [h, m] = startTime.split(':').map(Number);
    const totalMinutes = h * 60 + m + duration;
    const endH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const endM = String(totalMinutes % 60).padStart(2, '0');
    return `${endH}:${endM}`;
  };

  const handleBookFormServiceChange = (service) => {
    if (!service) {
      setSelectedService(null);
      setBookForm(f => ({ ...f, service_id: '', end_time: '' }));
      return;
    }
    setSelectedService(service);
    setBookForm(f => {
      const newEndTime = calculateEndTime(f.start_time, service.duration_minutes);
      return {
        ...f,
        service_id: service.id,
        service_search: service.name,
        end_time: newEndTime
      };
    });
  };

  const handleGenericSearch = (type, val, isDetail = false) => {
    const fieldMap = {
      customer: 'customer_name',
      service: 'service_search',
      employee: 'employee_search'
    };
    const field = fieldMap[type];
    const setter = isDetail ? setDetailEdit : setBookForm;
    const currentState = isDetail ? detailEdit : bookForm;

    setter(prev => ({
      ...prev,
      [field]: val,
      ...(type === 'customer' ? { customer_id: '', customer_search: val, customer_phone: '' } : {})
    }));

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    const searchVal = normalize(val);

    setSearchSuggestions(prev => ({ ...prev, type, loading: true }));
    searchTimeoutRef.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      try {
        let results = [];
        if (type === 'customer') {
          results = await getCustomers(val);
        } else if (type === 'service') {
          const filtered = services.filter(s => {
            if (!s.is_active) return false;
            const nameNorm = normalize(s.name);
            const descNorm = normalize(s.description);

            // 1. Direct match in name or description
            if (nameNorm.includes(searchVal) || descNorm.includes(searchVal)) return true;

            // 2. Dynamic shortcode match (first letters of each word)
            const words = s.name.trim().split(/\s+/).filter(Boolean);
            const shortcode = words.map(w => normalize(w.charAt(0))).join('');
            if (shortcode.includes(searchVal)) return true;

            return false;
          });

          // Dynamic grouping by category from database
          const categories = [...new Set(services.map(s => s.category).filter(Boolean))];

          const grouped = [];
          categories.forEach(cat => {
            const catServices = filtered.filter(s => s.category === cat);
            if (catServices.length > 0) {
              grouped.push({ isHeader: true, name: cat });
              grouped.push(...catServices);
            }
          });

          // Others
          const otherServices = filtered.filter(s => !s.category);
          if (otherServices.length > 0) {
            grouped.push({ isHeader: true, name: 'Khác' });
            grouped.push(...otherServices);
          }
          results = grouped;
        } else if (type === 'employee') {
          const emps = await getEmployees(currentState.branch_id || filterBranch);
          let active = emps.filter(e => e.is_active);

          if (currentState.booking_date) {
            // Filter by schedule
            const schedules = await getEmployeeSchedules({
              date_from: currentState.booking_date,
              date_to: currentState.booking_date
            });
            const availableIds = (schedules || [])
              .filter(s => !s.is_day_off)
              .map(s => s.employee_id);

            active = active.filter(e => availableIds.includes(e.id));
          }

          // Sort by tour order
          const tourKey = `tour_order_${currentState.branch_id || filterBranch}`;
          const tourOrder = sysSettings[tourKey] || [];

          results = active.sort((a, b) => {
            const idxA = tourOrder.indexOf(a.id);
            const idxB = tourOrder.indexOf(b.id);
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
          }).filter(e => normalize(e.name).includes(searchVal));
        }
        // Gõ tiếp trong lúc chờ → đã có lượt tìm mới hơn, bỏ kết quả cũ (tránh gợi ý nhảy về từ khóa cũ)
        if (seq !== searchSeqRef.current) return;
        setSearchSuggestions({ type, data: results, loading: false });
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        console.warn('[bookings] Tìm gợi ý lỗi:', err?.message);
        setSearchSuggestions(prev => ({ ...prev, loading: false }));
      }
    }, 300);
  };

  const handleSelectSuggestion = (type, item, isDetail = false) => {
    const setter = isDetail ? setDetailEdit : setBookForm;
    if (type === 'customer') {
      if (item === 'new') {
        const currentState = isDetail ? detailEdit : bookForm;
        const query = currentState.customer_name;
        const isPhone = /^\d+$/.test(query);
        setter(prev => ({
          ...prev,
          customer_id: '',
          customer_name: isPhone ? '' : query,
          customer_phone: isPhone ? query : ''
        }));
        if (!isDetail) setCustomerView('creating');
        else setDetailCustomerView('creating');
      } else {
        setter(prev => ({
          ...prev,
          customer_id: item.id,
          customer_name: item.name,
          customer_phone: item.phone || '',
          customer_email: item.email || '',
          customer_search: item.name
        }));
        if (!isDetail) setCustomerView('selected');
        else setDetailCustomerView('selected');
      }
    } else if (type === 'service') {
      if (isDetail) {
        setDetailEdit(f => {
          const newEndTime = calculateEndTime(f.start_time, item.duration_minutes);
          return {
            ...f,
            service_id: item.id,
            service_search: item.name,
            end_time: newEndTime
          };
        });
      } else {
        handleBookFormServiceChange(item);
      }
    } else if (type === 'employee') {
      setter(prev => ({
        ...prev,
        employee_id: item.id,
        employee_search: item.name
      }));
    }
    setSearchSuggestions({ type: null, data: [], loading: false });
  };

  const handleBookSubmit = async (e) => {
    e.preventDefault();
    if (isCreating) return;

    // Auto-assign "Khách lạ" if customer is empty
    let finalCustomerId = bookForm.customer_id;
    let finalCustomerName = bookForm.customer_name;
    let finalCustomerPhone = bookForm.customer_phone;

    if (!finalCustomerName && !finalCustomerId) {
      try {
        const allCustomers = await getCustomers(WALK_IN_CUSTOMER_NAME);
        const khachLa = allCustomers.find(c => normalize(c.name).includes(WALK_IN_NORMALIZED));
        if (khachLa) {
          finalCustomerId = khachLa.id;
          finalCustomerName = khachLa.name;
          finalCustomerPhone = khachLa.phone || '';
        }
      } catch (e) { /* ignore */ }
    }

    // Validation
    const required = {
      'Ngày': bookForm.booking_date,
      'Giờ bắt đầu': bookForm.start_time,
      'Chi nhánh': bookForm.branch_id
    };

    const missing = Object.entries(required).filter(([_, val]) => !val).map(([label]) => label);
    if (missing.length > 0) {
      toast.warn('Vui lòng điền các thông tin bắt buộc: ' + missing.join(', '));
      return;
    }

    setIsCreating(true);
    try {
      let finalServiceId = bookForm.service_id;
      let finalEndTime = bookForm.end_time;

      if (!finalServiceId) {
        const placeholder = services.find(s => normalize(s.name).includes(PLACEHOLDER_NORMALIZED));
        if (placeholder) {
          finalServiceId = placeholder.id;
          if (!finalEndTime || finalEndTime === '--:--' || finalEndTime === bookForm.start_time) {
            finalEndTime = calculateEndTime(bookForm.start_time, placeholder.duration_minutes || 0);
          }
        } else {
          toast.warn('Vui lòng chọn dịch vụ hoặc tạo dịch vụ "Giữ chỗ" để tiếp tục.');
          setIsCreating(false);
          return;
        }
      }

      const finalForm = {
        ...bookForm,
        service_id: finalServiceId,
        end_time: finalEndTime,
        customer_id: finalCustomerId || null,
        customer_name: normalizeName(finalCustomerName || WALK_IN_CUSTOMER_NAME),
        customer_phone: finalCustomerPhone || null
      };

      if (customerView !== 'creating' && !finalCustomerId && finalCustomerName) {
        finalForm.temporary_name = finalCustomerName;
        finalForm.customer_id = null;
        finalForm.customer_name = null;
        finalForm.customer_phone = null;
      }

      await createBooking(finalForm);
      notify('Đặt lịch thành công!');
      setModalOpen(false);
      loadBookings();
    } catch (err) {
      toast.error('Lỗi: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveDetail = async () => {
    if (!detailModal || !detailEdit) return;

    if (!detailEdit.service_id || !detailEdit.branch_id || !detailEdit.start_time || !detailEdit.employee_id) {
      toast.warn('Vui lòng chọn đầy đủ: dịch vụ, chi nhánh, giờ, nhân viên');
      return;
    }

    setDetailSaving(true);
    try {
      // 1. Update Booking
      const bookingUpdate = {
        service_id: detailEdit.service_id,
        branch_id: detailEdit.branch_id,
        start_time: detailEdit.start_time,
        booking_date: detailEdit.booking_date,
        end_time: detailEdit.end_time,
        employee_id: detailEdit.employee_id,
        notes: detailEdit.notes,
        customer_id: detailEdit.customer_id || null
      };

      if (!bookingUpdate.customer_id && detailEdit.customer_name) {
        bookingUpdate.temporary_name = detailEdit.customer_name;
      } else {
        bookingUpdate.temporary_name = null;
      }

      // 2. Cùng khách nhưng thông tin khách đổi → gửi kèm customer_update trong CÙNG request
      // (backend cập nhật khách + lịch, lỗi thì hoàn lại thông tin khách — không còn cập nhật nửa vời)
      const cust = detailModal.customers;
      if (bookingUpdate.customer_id && cust && (
        detailEdit.customer_name !== cust.name ||
        detailEdit.customer_phone !== (cust.phone || '') ||
        detailEdit.customer_habits !== (cust.habits || '') ||
        detailEdit.customer_email !== (cust.email || '')
      )) {
        bookingUpdate.customer_update = {
          name: detailEdit.customer_name,
          phone: detailEdit.customer_phone,
          email: detailEdit.customer_email,
          habits: detailEdit.customer_habits
        };
      }

      const updated = await updateBookingConfirmingConflict(detailModal.id, bookingUpdate);
      if (!updated) return; // chọn không lưu khi trùng lịch → giữ modal để chỉnh tiếp

      // update list in UI immediately
      loadBookings();

      if (typeof notify === 'function') {
        notify('Cập nhật thành công!');
      }

      setDetailModal(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDetailSaving(false);
    }
  };

  const handleOpenDetail = async (booking) => {
    // Prevent opening detail view for temporary slot holds
    if (isHoldBooking(booking)) return;

    setDetailModal(booking);

    setDetailEdit({
      service_id: booking.service_id || booking.services?.id || '',
      service_search: booking.services?.name || '',
      branch_id: booking.branch_id || booking.branches?.id || '',
      booking_date: booking.booking_date || '',
      start_time: (booking.start_time || '').substring(0, 5),
      end_time: (booking.end_time || '').substring(0, 5),
      employee_id: booking.employee_id || booking.employees?.id || '',
      employee_search: booking.employees?.name || '',
      customer_search: booking.temporary_name || booking.customers?.name || '',
      notes: booking.notes || '',
      internal_note: booking.internal_note || '',
      customer_name: booking.temporary_name || booking.customers?.name || '',
      customer_id: booking.customers?.id || '',
      customer_phone: booking.customers?.phone || '',
      customer_email: booking.customers?.email || '',
      customer_habits: booking.customers?.habits || ''
    });

    setDetailCustomerView('selected');
    setDetailTab('schedule');
    setShowDetailMore(false);
  };

  const checkStaffAvailability = async (empId, date, start, end) => {
    if (!empId || !date || !start || !end) return true;
    try {
      const resp = await getEmployeeSchedules({
        employee_id: empId,
        date_from: date,
        date_to: date
      });
      const sched = (resp || [])[0];
      if (!sched || sched.is_day_off) return false;

      const startMin = timeToMinutes(start);
      const endMin = timeToMinutes(end);
      const sStart = timeToMinutes(String(sched.start_time).substring(0, 5));
      const sEnd = timeToMinutes(String(sched.end_time).substring(0, 5));

      return startMin >= sStart && endMin <= sEnd;
    } catch (err) {

      return true;
    }
  };

  const handleDateChange = async (newDate) => {
    setDetailEdit(prev => ({ ...prev, booking_date: newDate }));

    const isAvail = await checkStaffAvailability(detailEdit.employee_id, newDate, detailEdit.start_time, detailEdit.end_time);
    if (!isAvail) {
      setDetailEdit(prev => ({ ...prev, employee_id: '' }));
      toast.warn('Nhân viên không làm việc hoặc không có ca trực vào ngày đã chọn.', { position: 'bottom-right' });
    }
  };

  const handleTimeChange = async (type, newVal) => {
    const updated = { ...detailEdit, [type]: newVal };
    if (type === 'start_time') {
      const duration = services.find(s => s.id === detailEdit.service_id)?.duration_minutes || 0;
      updated.end_time = calculateEndTime(newVal, duration);
    }
    setDetailEdit(updated);

    const isAvail = await checkStaffAvailability(updated.employee_id, updated.booking_date, updated.start_time, updated.end_time);
    if (!isAvail) {
      setDetailEdit(prev => ({ ...prev, employee_id: '' }));
      toast.warn('Nhân viên không làm việc hoặc không có ca trực vào khung giờ mới.', { position: 'bottom-right' });
    }
  };

  const isDetailModified = useMemo(() => {
    if (!detailModal || !detailEdit) return false;
    return (
      detailEdit.service_id !== (detailModal.service_id || detailModal.services?.id) ||
      detailEdit.booking_date !== detailModal.booking_date ||
      detailEdit.start_time !== (detailModal.start_time || '').substring(0, 5) ||
      detailEdit.end_time !== (detailModal.end_time || '').substring(0, 5) ||
      detailEdit.employee_id !== (detailModal.employee_id || detailModal.employees?.id) ||
      detailEdit.notes !== (detailModal.notes || '') ||
      detailEdit.customer_name !== (detailModal.temporary_name || detailModal.customers?.name || '') ||
      detailEdit.customer_phone !== (detailModal.customers?.phone || '') ||
      detailEdit.customer_habits !== (detailModal.customers?.habits || '') ||
      detailEdit.customer_email !== (detailModal.customers?.email || '') ||
      detailEdit.customer_id !== (detailModal.customer_id || detailModal.customers?.id || '')
    );
  }, [detailModal, detailEdit]);

  const handleDismissWarning = async (e, booking) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    // Lịch giữ chỗ tạm thời: xóa internal_note sẽ khiến job dọn giữ chỗ không nhận ra → chiếm slot vĩnh viễn
    if (!booking || isHoldBooking(booking)) return;

    try {
      const bookingUpdate = {
        service_id: booking.service_id || booking.services?.id || '',
        branch_id: booking.branch_id || booking.branches?.id || '',
        employee_id: booking.employee_id || booking.employees?.id || '',
        booking_date: booking.booking_date || '',
        start_time: (booking.start_time || '').substring(0, 5),
        end_time: (booking.end_time || '').substring(0, 5),
        customer_id: booking.customer_id || booking.customers?.id || null,
        temporary_name: booking.temporary_name || null,
        notes: booking.notes || '',
        internal_note: null // Clear warning
      };

      await updateBooking(booking.id, bookingUpdate);

      if (detailModal && detailModal.id === booking.id) {
        setDetailEdit(prev => ({ ...prev, internal_note: '' }));
      }

      notify('Đã tắt cảnh báo và khôi phục màu dịch vụ!');
      loadBookings();
    } catch (err) {

      toast.error('Không thể tắt cảnh báo: ' + err.message);
    }
  };


  const todayStr = toDateStr(new Date());
  const isToday = toDateStr(currentDate) === todayStr;

  // Mobile list view: gộp các lịch cùng group_booking_id (khách đi nhóm) thành 1 card
  const mobileListItems = useMemo(() => {
    const groups = new Map();
    for (const b of bookings) {
      const key = b.group_booking_id || b.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }

    const byStart = (a, b) => (a.start_time || '').localeCompare(b.start_time || '');
    const unique = (arr) => [...new Set(arr.map(s => (s || '').trim()).filter(Boolean))];

    return [...groups.entries()].map(([key, members]) => {
      const sorted = [...members].sort(byStart);
      const lead = sorted[0];
      const endTime = sorted.reduce((max, m) => ((m.end_time || '') > max ? m.end_time : max), lead.end_time || '');
      return {
        key,
        lead,
        ids: sorted.map(m => m.id),
        guestCount: sorted.length,
        endTime,
        serviceNames: unique(sorted.map(m => m.services?.name)).join(' + '),
        notes: unique(sorted.map(m => m.notes)),
        internalNotes: unique(sorted.map(m => m.internal_note))
      };
    }).sort((a, b) => byStart(a.lead, b.lead));
  }, [bookings]);

  return (
    <div className='full-view full-view-bookings' style={{ '--staff-count': loading ? 3 : (employees.length || 1) }}>
      {/* Calendar Toolbar */}
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

      {/* Calendar View */}
      {viewMode === 'calendar' ? (
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

                  return employees.map(emp => {
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
                        className={`cal-staff-column ${isAvailable ? 'available' : 'unavailable'} ${employees.indexOf(emp) === 0 ? 'is-first-staff' : ''}`}
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
                              {employees.indexOf(emp) === 0 && (
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
                        {bookings.filter(b => (b.employee_id === emp.id || b.employees?.id === emp.id)).map(b => {
                          const startMin = timeToMinutes(b.start_time);
                          const endMin = timeToMinutes(b.end_time);
                          const top = (startMin - OPEN_HOUR * 60) / 60 * 100;
                          const height = (endMin - startMin) / 60 * 100;
                          const cardBg = getBookingColor(b);
                          const textColor = '#555555';

                          const isHold = isHoldBooking(b);
                          const isSpamWarning = isSpamWarningBooking(b);

                          return (
                            <div
                              key={b.id}
                              id={`booking-card-${b.id}`}
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
      ) : (
        /* List View */
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
                    bookings.map(b => (
                        <tr key={b.id} id={`booking-card-${b.id}`} onClick={() => handleOpenDetail(b)} className={`cursor-pointer${isSpamWarningBooking(b) ? ' row-spam-warning' : ''}${isHoldBooking(b) ? ' is-hold-disabled' : ''}`}>
                          <td>
                            <div className="list-booking-name">{b.temporary_name || b.customers?.name || '-'}</div>
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
                      ))
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
                mobileListItems.map(({ key, lead, ids, guestCount, endTime, serviceNames, notes, internalNotes }) => {
                  const isHold = isHoldBooking(lead);
                  return (
                    <div
                      key={key}
                      id={`booking-card-${lead.id}`}
                      data-booking-ids={ids.join(' ')}
                      className={`booking-card-mobile${isSpamWarningBooking(lead) ? ' row-spam-warning' : ''}${isHold ? ' is-hold-disabled' : ''}`}
                      onClick={() => { if (!isHold) handleOpenDetail(lead); }}
                    >
                      <div className="booking-card-mobile-header">
                        <span className="booking-card-mobile-customer">{lead.temporary_name || lead.customers?.name || '-'}</span>
                        <span className="booking-card-mobile-time">{formatTime(lead.start_time)} - {guestCount} khách</span>
                      </div>
                      <div className="booking-card-mobile-body">
                        <span className="booking-card-mobile-service">
                          <span className="service-icon-dot sm" style={{ background: lead.services?.color || '#0d8a3f' }}></span>
                          {serviceNames || '-'}
                        </span>
                        <span className={`badge badge-${lead.status}`}>{bookingStatusLabel(lead.status)}</span>
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
      )}


      {/* Booking Detail Modal */}
      {detailModal && (
        <div className="modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="modal modal-viewing max-w-480" onClick={e => e.stopPropagation()}>
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

      {/* Create Booking Modal */}
      {
        modalOpen && (
          <div className="modal-overlay" onClick={() => setModalOpen(false)}>
            <div className="modal modal-max-480" onClick={e => e.stopPropagation()}>
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
                  <button type="submit" className="btn btn-primary btn-submit-booking" disabled={isCreating}>
                    {isCreating ? 'Đang Tạo...' : 'Tạo'}
                  </button>
                </div>
              </form>
            </div>
          </div >
        )
      }

      {/* Drag & Drop Confirmation Popup */}
      {dragConfirm && (
        <div className="modal-overlay drag-confirm-overlay" onClick={handleDragCancel}>
          <div className="drag-confirm-popup" onClick={e => e.stopPropagation()}>
            <div className="drag-confirm-header">
              <h3 className="drag-confirm-title">Xác nhận thay đổi?</h3>
              <button className="modal-close" aria-label="Đóng" onClick={handleDragCancel}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M19 5L5 19" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path d="M5 5L19 19" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>
            <div className="drag-confirm-body">
              <div className="drag-confirm-label">Từ:</div>
              <div className="drag-confirm-row">
                <div className="drag-confirm-time-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <span className="drag-confirm-time">{dragConfirm.fromTime}</span>
                <div className="drag-confirm-staff-badge">
                  <span className="drag-confirm-staff-initial">{getInitial(dragConfirm.fromStaff, 'A', { upper: true })}</span>
                  <span className="drag-confirm-staff-name">{dragConfirm.fromStaff}</span>
                </div>
              </div>
              <div className="drag-confirm-label">Thành:</div>
              <div className="drag-confirm-row">
                <div className="drag-confirm-time-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <span className="drag-confirm-time">{dragConfirm.toTime}</span>
                <div className="drag-confirm-staff-badge">
                  <span className="drag-confirm-staff-initial">{getInitial(dragConfirm.toStaff, 'A', { upper: true })}</span>
                  <span className="drag-confirm-staff-name">{dragConfirm.toStaff}</span>
                </div>
              </div>
            </div>
            <div className="drag-confirm-actions">
              <button className="drag-confirm-cancel" onClick={handleDragCancel}>Hủy, giữ nguyên</button>
              <button className="drag-confirm-submit" onClick={handleDragConfirm}>Thay Đổi</button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
}

export default Bookings;
