import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FiPlus, FiChevronLeft, FiChevronRight, FiCalendar, FiList, FiMoreVertical, FiX, FiAlertTriangle } from 'react-icons/fi';
import { HiOutlineChevronLeft, HiOutlineChevronRight } from "react-icons/hi";
import { toast } from 'react-toastify';
import TimePickerInput from '../components/TimePickerInput';

import {
  getBookingsRange, createBooking, updateBooking, deleteBooking,
  getBranches, getServices, getEmployees, getCustomers, updateCustomer, getEmployeeSchedules,
  getSettings
} from '../api';

import userIcon from '../assets/user-icon.svg';
import shopIcon from '../assets/shop-icon.svg';
import clockIcon from '../assets/clock-icon.svg';
import noteIcon from '../assets/note-icon.svg';

import { DatePicker, parseDate } from "@chakra-ui/react"
import { supabase } from '../supabaseClient';
// import '../styles/timepicker.css';
import '../styles/bookings.css';
// ---- Helpers ----
const OPEN_HOUR = 9;
const CLOSE_HOUR = 23;
const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

function getWeekDates(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d);
  monday.setDate(diff);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd;
  });
}

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

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const timeToPixels = (t) => {
  if (!t) return 0;
  const startMins = OPEN_HOUR * 60;
  const currentMins = timeToMinutes(t);
  return ((currentMins - startMins) / 60) * 100;
};

const STATUS_COLORS = {
  confirmed: { bg: '#e6f4ec', border: '#0d8a3f', text: '#0d8a3f' },
  pending: { bg: '#fef3e2', border: '#e67e22', text: '#e67e22' },
  completed: { bg: '#eff6ff', border: '#2563eb', text: '#2563eb' }
};

const normalize = (str) => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();


const getBookingColor = (booking) => {
  if (booking.status === 'pending' && booking.internal_note) {
    return STATUS_COLORS.pending.bg;
  }

  const name = normalize(booking.customers?.name || '');
  if (name === 'khach la') {
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
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
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

function Bookings({ data }) {
  // Responsive: detect mobile for PWA
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'list'
  // On mobile, always force list view
  const effectiveViewMode = isMobile ? 'list' : viewMode;

  const [currentDate, setCurrentDate] = useState(new Date());

  const [bookings, setBookings] = useState([]);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]); // All active employees of filtered branch
  const [filterBranch, setFilterBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Booking modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailEdit, setDetailEdit] = useState(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailCustomerView, setDetailCustomerView] = useState('selected'); // 'selected', 'searching', 'creating'
  const [employeesByBranch, setEmployeesByBranch] = useState([]); // for dropdown in detail edit
  const [bookForm, setBookForm] = useState({
    branch_id: '', service_id: '', num_guests: 1,
    customer_name: '', customer_phone: '', customer_email: '',
    booking_date: '', start_time: '', notes: ''
  });
  const [availSlots, setAvailSlots] = useState([]);
  const [bookStep, setBookStep] = useState(1);
  const [selectedService, setSelectedService] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState({ type: null, data: [], loading: false });
  const [customerView, setCustomerView] = useState('default'); // 'default', 'searching', 'selected', 'creating'
  const [showCalendar, setShowCalendar] = useState(false);
  const [detailTab, setDetailTab] = useState('schedule'); // 'schedule' or 'customer'
  const [employeeSchedules, setEmployeeSchedules] = useState([]);
  const [showDetailMore, setShowDetailMore] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // Drag-and-drop reorder state
  const [cardDrag, setCardDrag] = useState(null); // { booking, startCol, startTop }
  const [cardDragClone, setCardDragClone] = useState(null);
  const [dragConfirm, setDragConfirm] = useState(null); // { booking, fromStaff, fromTime, toStaff, toTime, toStaffId, newDate, newStart, newEnd }
  // Drag-to-create state
  const [dragInfo, setDragInfo] = useState(null); // { startY, currentY, staffId, staffName, columnEl }
  const [hoverInfo, setHoverInfo] = useState(null); // { staffId, y, colLeft, colWidth }
  const [bufferTime, setBufferTime] = useState(15);
  const [sysSettings, setSysSettings] = useState({});
  const calendarRef = useRef(null);
  const moreMenuRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const gridRef = useRef(null);

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  const bodyRef = useRef(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const notify = (msg) => {
    toast.success(msg || "Cập nhật thành công", {
      position: "bottom-right"
    });
  };

  useLayoutEffect(() => {
    if (!bodyRef.current) return;

    const calculate = () => {
      const el = bodyRef.current;
      const width = el.offsetWidth - el.clientWidth;
      setScrollbarWidth(width);
    };

    const observer = new ResizeObserver(() => {
      calculate();
    });

    observer.observe(bodyRef.current);

    calculate();

    return () => observer.disconnect();
  }, [data]);

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

  // Ultra-fast helper to refresh ONLY bookings without refetching employees/settings/schedules.
  // This drastically reduces API calls from 4 to 1 per real-time event.
  const refreshBookingsOnly = async () => {
    const branchId = filterBranchRef.current;
    const dateStr = toDateStr(currentDateRef.current);
    if (!branchId) return;

    try {
      const bookingsData = await getBookingsRange(dateStr, dateStr, branchId);
      setBookings(bookingsData.filter(b => b.status !== 'cancelled'));
    } catch (err) {
      console.error("📡 Error refreshing bookings in real-time:", err);
    }
  };

  useEffect(() => {
    loadBookings();
  }, [currentDate, filterBranch]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // ---- Live Booking Updates (SSE & Supabase Realtime) ----
  useEffect(() => {
    // 1) Supabase Realtime (for booking creations & holds on other ports/backends)
    const channel = supabase
      .channel('realtime-bookings')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings'
        },
        (payload) => {
          console.log('📡 Supabase Realtime: Booking change detected!', payload);
          refreshBookingsOnly();
        }
      )
      .subscribe();

    // 2) SSE Connection (for backend events on this server)
    const API_BASE = import.meta.env.VITE_API_BASE;
    const sseUrl = API_BASE.replace(/\/api$/, '') + '/api/events';

    let eventSource;
    let reconnectTimer;

    const connect = () => {
      eventSource = new EventSource(sseUrl);

      eventSource.addEventListener('booking.created', (e) => {
        console.log('📡 SSE: New booking created', JSON.parse(e.data));
        refreshBookingsOnly();
      });

      eventSource.addEventListener('booking.updated', (e) => {
        console.log('📡 SSE: Booking updated', JSON.parse(e.data));
        refreshBookingsOnly();
      });

      eventSource.addEventListener('booking.deleted', (e) => {
        console.log('📡 SSE: Booking deleted', JSON.parse(e.data));
        refreshBookingsOnly();
      });

      eventSource.addEventListener('booking.hold', (e) => {
        console.log('📡 SSE: Slot hold created', JSON.parse(e.data));
        refreshBookingsOnly();
      });

      eventSource.addEventListener('booking.hold_released', (e) => {
        console.log('📡 SSE: Slot hold released', JSON.parse(e.data));
        refreshBookingsOnly();
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
  }, []); // Connect once on mount

  // Effect to handle navigating/scrolling to a specific booking from a notification
  useEffect(() => {
    const handleGotoBooking = (detail) => {
      if (!detail || !detail.bookingId || !detail.bookingDate) return;

      // 1. Change the date of the calendar grid
      const targetDate = new Date(detail.bookingDate + 'T00:00:00');
      setCurrentDate(targetDate);

      // 2. Wait for the state to update, the new date's bookings to load and the DOM to render
      // We can poll the DOM for the booking card element
      let attempts = 0;
      const interval = setInterval(() => {
        const cardEl = document.getElementById(`booking-card-${detail.bookingId}`);
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
        if (attempts > 30) { // Timeout after 3 seconds (30 * 100ms)
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
          console.error("Error parsing goto_booking", e);
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
  }, [loading, bookings]);

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

      if (settingsData && settingsData.buffer_time) {
        setBufferTime(parseInt(settingsData.buffer_time) || 0);
      }

      if (b.length > 0 && !filterBranch) {
        setFilterBranch(b[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadBookings = async () => {
    setLoading(true);
    try {
      const dayStr = toDateStr(currentDate);
      // Fetch bookings, employees, schedules AND latest settings
      const [bookingsData, employeesData, schedulesData, settingsData] = await Promise.all([
        getBookingsRange(dayStr, dayStr, filterBranch || undefined),
        filterBranch ? getEmployees(filterBranch) : Promise.resolve([]),
        getEmployeeSchedules({ date_from: dayStr, date_to: dayStr }),
        getSettings()
      ]);

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
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Navigation
  const goToday = () => setCurrentDate(new Date());
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
    if (!confirm('Bạn có chắc muốn hủy lịch hẹn này?')) return;
    try {
      await deleteBooking(id);
      notify('Đã hủy lịch hẹn thành công!');
      loadBookings();
      setDetailModal(null);
    } catch (err) {
      alert(err.message);
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
    const isHold = booking.status === 'pending' && booking.internal_note && booking.internal_note.includes('Khách đang đặt');
    if (isHold) return;

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

  const handleDragConfirm = async () => {
    if (!dragConfirm) return;
    try {
      const bk = dragConfirm.booking;
      await updateBooking(bk.id, {
        service_id: bk.service_id || bk.services?.id,
        branch_id: bk.branch_id || bk.branches?.id,
        employee_id: dragConfirm.toStaffId,
        start_time: dragConfirm.newStart,
        end_time: dragConfirm.newEnd,
        booking_date: dragConfirm.newDate
      });
      notify('Đã cập nhật lịch hẹn!');
      loadBookings();
    } catch (err) {
      alert('Lỗi: ' + err.message);
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
    setBookStep(1);
    setCustomerView('default');
    setAvailSlots([]);
    setAvailSlots([]);
    setSelectedService(null);
    setIsDuplicating(false);
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
    setIsDuplicating(true);
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
    setAvailSlots([]);
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
        setSearchSuggestions({ type, data: results, loading: false });
      } catch (err) {
        console.error('Search error:', err);
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
        const allCustomers = await getCustomers('Khách lạ');
        const khachLa = allCustomers.find(c => normalize(c.name).includes('khach la'));
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
      alert('Vui lòng điền các thông tin bắt buộc: ' + missing.join(', '));
      return;
    }

    setIsCreating(true);
    try {
      let finalServiceId = bookForm.service_id;
      let finalEndTime = bookForm.end_time;

      if (!finalServiceId) {
        const placeholder = services.find(s => normalize(s.name).includes('giu cho'));
        if (placeholder) {
          finalServiceId = placeholder.id;
          if (!finalEndTime || finalEndTime === '--:--' || finalEndTime === bookForm.start_time) {
            finalEndTime = calculateEndTime(bookForm.start_time, placeholder.duration_minutes || 0);
          }
        } else {
          alert('Vui lòng chọn dịch vụ hoặc tạo dịch vụ "Giữ chỗ" để tiếp tục.');
          setIsCreating(false);
          return;
        }
      }

      const finalForm = {
        ...bookForm,
        service_id: finalServiceId,
        end_time: finalEndTime,
        customer_id: finalCustomerId,
        customer_name: normalizeName(finalCustomerName || 'Khách lạ'),
        customer_phone: finalCustomerPhone
      };
      await createBooking(finalForm);
      notify('Đặt lịch thành công!');
      setModalOpen(false);
      loadBookings();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveDetail = async () => {
    if (!detailModal || !detailEdit) return;

    if (!detailEdit.service_id || !detailEdit.branch_id || !detailEdit.start_time || !detailEdit.employee_id) {
      alert('Vui lòng chọn đầy đủ: dịch vụ, chi nhánh, giờ, nhân viên');
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
        customer_id: detailEdit.customer_id || (detailModal.customer_id || detailModal.customers?.id)
      };

      const updated = await updateBooking(detailModal.id, bookingUpdate);

      // 2. Update Customer Info if it's the SAME customer but info changed
      const cust = detailModal.customers;
      if (detailEdit.customer_id === (detailModal.customer_id || detailModal.customers?.id) && cust && (
        detailEdit.customer_name !== cust.name ||
        detailEdit.customer_phone !== (cust.phone || '') ||
        detailEdit.customer_habits !== (cust.habits || '') ||
        detailEdit.customer_email !== (cust.email || '')
      )) {
        await updateCustomer(detailEdit.customer_id, {
          name: detailEdit.customer_name,
          phone: detailEdit.customer_phone,
          email: detailEdit.customer_email,
          habits: detailEdit.customer_habits
        });
        updated.customers = { ...updated.customers, name: detailEdit.customer_name, phone: detailEdit.customer_phone, email: detailEdit.customer_email, habits: detailEdit.customer_habits };
      }

      // update list in UI immediately
      loadBookings();

      if (typeof notify === 'function') {
        notify('Cập nhật thành công!');
      }

      setDetailModal(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setDetailSaving(false);
    }
  };

  const handleOpenDetail = async (booking) => {
    // Prevent opening detail view for temporary slot holds
    const isHold = booking.status === 'pending' && booking.internal_note && booking.internal_note.includes('Khách đang đặt');
    if (isHold) return;

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
      customer_search: booking.customers?.name || '',
      notes: booking.notes || '',
      internal_note: booking.internal_note || '',
      customer_name: booking.customers?.name || '',
      customer_id: booking.customers?.id || '',
      customer_phone: booking.customers?.phone || '',
      customer_email: booking.customers?.email || '',
      customer_habits: booking.customers?.habits || ''
    });

    setDetailCustomerView('selected');
    setDetailTab('schedule');
    setShowDetailMore(false);
    loadEmployeesForDetail(booking.branch_id, booking.booking_date);
  };

  const loadEmployeesForDetail = async (branchId, date) => {
    try {
      const emps = await getEmployees(branchId);
      const schedules = await getEmployeeSchedules({
        date_from: date,
        date_to: date
      });
      const availableIds = (schedules || [])
        .filter(s => !s.is_day_off)
        .map(s => s.employee_id);

      setEmployeesByBranch((emps || []).filter(e => e.is_active && availableIds.includes(e.id)));
    } catch (e) {
      console.error(e);
      setEmployeesByBranch([]);
    }
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
      console.error('Availability check failed:', err);
      return true;
    }
  };

  const handleDateChange = async (newDate) => {
    setDetailEdit(prev => ({ ...prev, booking_date: newDate }));
    loadEmployeesForDetail(detailEdit.branch_id, newDate);

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
      detailEdit.customer_name !== (detailModal.customers?.name || '') ||
      detailEdit.customer_phone !== (detailModal.customers?.phone || '') ||
      detailEdit.customer_habits !== (detailModal.customers?.habits || '') ||
      detailEdit.customer_email !== (detailModal.customers?.email || '') ||
      detailEdit.customer_id !== (detailModal.customer_id || detailModal.customers?.id || '')
    );
  }, [detailModal, detailEdit]);

  const handleStatusUpdate = async (status) => {
    if (!detailModal) return;
    try {
      setDetailSaving(true);
      const { updateBookingStatus } = await import('../api'); // Assuming it exists or use updateBooking
      // If updateBookingStatus doesn't exist, we can use updateBooking with just status
      await updateBooking(detailModal.id, { status });
      notify('Đã cập nhật trạng thái!');
      setDetailModal(null);
      loadBookings();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    } finally {
      setDetailSaving(false);
    }
  };

  const handleDismissWarning = async (e, booking) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!booking) return;

    try {
      const bookingUpdate = {
        service_id: booking.service_id || booking.services?.id || '',
        branch_id: booking.branch_id || booking.branches?.id || '',
        employee_id: booking.employee_id || booking.employees?.id || '',
        booking_date: booking.booking_date || '',
        start_time: (booking.start_time || '').substring(0, 5),
        end_time: (booking.end_time || '').substring(0, 5),
        customer_id: booking.customer_id || booking.customers?.id || '',
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
      console.error(err);
      alert('Không thể tắt cảnh báo: ' + err.message);
    }
  };


  // Date options
  const dateOptions = [];
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dateOptions.push({
      value: toDateStr(d),
      label: `${DAY_NAMES[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
    });
  }

  // Get bookings for a specific day and hour
  const getBookingsForSlot = (dateStr, hour) => {
    return bookings.filter(b => {
      if (b.booking_date !== dateStr) return false;
      const startMin = timeToMinutes(b.start_time);
      const endMin = timeToMinutes(b.end_time);
      const slotStart = hour * 60;
      const slotEnd = (hour + 1) * 60;
      return startMin < slotEnd && endMin > slotStart;
    });
  };

  // Calculate event position
  const getEventStyle = (booking, hour) => {
    const startMin = timeToMinutes(booking.start_time);
    const endMin = timeToMinutes(booking.end_time);
    const hourStart = hour * 60;
    const hourEnd = (hour + 1) * 60;

    const top = Math.max(0, startMin - hourStart);
    const bottom = Math.min(60, endMin - hourStart);
    const height = bottom - top;

    // Only render in the first hour of the event
    if (startMin < hourStart) return null;

    const durationHours = (endMin - startMin) / 60;

    return {
      top: `${(top / 60) * 100}%`,
      height: `${durationHours * 100}%`,
      minHeight: `${Math.max(height / 60 * 100, 20)}%`
    };
  };

  // Week header label
  const weekLabel = `${weekDates[0].getDate()}/${weekDates[0].getMonth() + 1} – ${weekDates[6].getDate()}/${weekDates[6].getMonth() + 1}/${weekDates[6].getFullYear()}`;
  const todayStr = toDateStr(new Date());

  return (
    <div className='full-view full-view-bookings' style={{ '--staff-count': loading ? 3 : (employees.length || 1) }}>
      {/* Calendar Toolbar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar-wrap">
          <div className="cal-toolbar-left">
            <span className="cal-week-label">
              {currentDate.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <button className="btn-icon" onClick={goPrev} title="Ngày trước"><FiChevronLeft /></button>
            <button className="btn-icon" onClick={goNext} title="Ngày sau"><FiChevronRight /></button>
            <button className="btn btn-sm btn-ghost fs-15 fw-500" onClick={goToday}>Hôm nay</button>
          </div>
          <div className="cal-toolbar-right">
            {/* Hide view toggle on mobile — mobile always shows list */}
            {!isMobile && (
              <div className="cal-view-toggle">
                <button className={`cal-view-btn${effectiveViewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')}>
                  <FiCalendar size={14} />
                </button>
                <button className={`cal-view-btn${effectiveViewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>
                  <FiList size={14} />
                </button>
              </div>
            )}
            <select className="form-select max-w-200"
              value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => openBookingModal()}>
              <FiPlus />
            </button>
          </div>
        </div>
        {effectiveViewMode === 'calendar' && (
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
      {effectiveViewMode === 'calendar' ? (

        <div className="cal-container">

          <div className='calendar-grid' ref={gridRef}>
            {/* Time labels column */}
            <div className="cal-time-column">
              {HOURS.map(hour => (
                <div key={hour} className="cal-time-slot">
                  {(() => {
                    const h12 = hour % 12 === 0 ? 12 : hour % 12;
                    const period = hour < 12 ? 'AM' : 'PM';
                    return `${String(h12).padStart(2, '0')}:00 ${period}`;
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
                const branchOpenMin = isWeekday ? Math.max(baseBranchOpenMin, 10 * 60) : baseBranchOpenMin;
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
                      className={`cal-staff-column ${isAvailable ? 'available' : 'unavailable'}`}
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
                      {toDateStr(currentDate) === toDateStr(now) && (
                        <div className="cal-now-line" style={{ top: `${(timeToMinutes(`${now.getHours()}:${now.getMinutes()}`) - OPEN_HOUR * 60) / 60 * 100}px` }}>
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
                      )}

                      {/* Bookings for this staff */}
                      {bookings.filter(b => (b.employee_id === emp.id || b.employees?.id === emp.id)).map(b => {
                        const startMin = timeToMinutes(b.start_time);
                        const endMin = timeToMinutes(b.end_time);
                        const top = (startMin - OPEN_HOUR * 60) / 60 * 100;
                        const height = (endMin - startMin) / 60 * 100;
                        const cardBg = getBookingColor(b);
                        const textColor = '#555555';

                        const isHold = b.status === 'pending' && b.internal_note && b.internal_note.includes('Khách đang đặt');
                        const isSpamWarning = b.status === 'pending' && b.internal_note && !isHold;

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
                              {b.notes ? <img src={noteIcon} alt='note icon' className="cal-booking-icon" /> : null}
                              <div className="cal-booking-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {isSpamWarning && <FiAlertTriangle size={12} className="text-warning-orange" style={{ minWidth: '12px' }} />}
                                {b.customers?.name}
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
                              {b.notes ? <img src={noteIcon} alt='note icon' className="cal-booking-icon" /> : null}
                              <div className="cal-booking-name">{b.customers?.name}</div>
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
      ) : (
        /* List View */
        <div className="card">
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
                    bookings
                      .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                      .map(b => (
                        <tr key={b.id} id={`booking-card-${b.id}`} onClick={() => handleOpenDetail(b)} className={`cursor-pointer${b.status === 'pending' && b.internal_note ? ' row-spam-warning' : ''}`}>
                          <td>
                            <div className="fw-600">{b.customers?.name || '-'}</div>
                            <div className="fs-12 text-muted">{b.customers?.phone}</div>
                          </td>
                          <td>{b.services?.name || '-'}</td>
                          <td>{b.branches?.name || '-'}</td>
                          <td>{new Date(b.booking_date + 'T00:00:00').toLocaleDateString('vi-VN')}</td>
                          <td>{formatTime(b.start_time)} - {formatTime(b.end_time)}</td>
                          <td>{b.employees?.name || '-'}</td>
                          <td>
                            {b.notes || '-'}
                            {b.internal_note && <div className="fs-11 text-warning-orange mt-2">{b.internal_note}</div>}
                          </td>
                          <td>
                            <span className={`badge badge-${b.status}`}>{b.status}</span>
                          </td>
                          <td className="fw-600">{formatPrice(b.total_price)}</td>
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
              ) : bookings.length === 0 ? (
                <div className="empty-state">
                  <FiCalendar size={32} />
                  <h4>Không có lịch hẹn</h4>
                  <p>Chưa có lịch hẹn nào trong ngày này</p>
                </div>
              ) : (
                bookings
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map(b => {
                    const isHold = b.status === 'pending' && b.internal_note && b.internal_note.includes('Khách đang đặt');
                    return (
                      <div
                        key={b.id}
                        id={`booking-card-${b.id}`}
                        className={`booking-card-mobile${b.status === 'pending' && b.internal_note ? ' row-spam-warning' : ''}${isHold ? ' is-hold-disabled' : ''}`}
                        onClick={() => handleOpenDetail(b)}
                      >
                        <div className="booking-card-mobile-header">
                          <span className="booking-card-mobile-customer">{b.customers?.name || '-'}</span>
                          <span className="booking-card-mobile-time">{formatTime(b.start_time)} - {formatTime(b.end_time)}</span>
                        </div>
                        <div className="booking-card-mobile-body">
                          <span className="booking-card-mobile-service">
                            <span className="service-icon-dot sm" style={{ background: b.services?.color || '#0d8a3f' }}></span>
                            {b.services?.name || '-'}
                          </span>
                          <span className="booking-card-mobile-staff">{b.employees?.name || '-'}</span>
                        </div>
                        <div className="booking-card-mobile-footer">
                          <span className={`badge badge-${b.status}`}>{b.status}</span>
                          <span className="booking-card-mobile-price">{formatPrice(b.total_price)}</span>
                        </div>
                        {b.internal_note && <div className="fs-11 text-warning-orange">{b.internal_note}</div>}
                      </div>
                    );
                  })
              )}
            </div>
          )}

          {/* Pagination Footer */}
          <div className="pagination-container">
            <div className="items-per-page">
              <span>Hiển thị</span>
              <select className="ipp-select" value={itemsPerPage} onChange={e => { setItemsPerPage(parseInt(e.target.value)); setCurrentPage(1); }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>kết quả mỗi trang</span>
            </div>
            <div className="pagination-controls">
              <button className="page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><HiOutlineChevronLeft /></button>
              {Array.from({ length: Math.ceil(bookings.length / itemsPerPage) }, (_, i) => (
                <button
                  key={i + 1}
                  className={`page-btn${currentPage === i + 1 ? ' active' : ''}`}
                  onClick={() => setCurrentPage(i + 1)}
                >
                  {i + 1}
                </button>
              )).slice(Math.max(0, currentPage - 3), Math.min(Math.ceil(bookings.length / itemsPerPage), currentPage + 2))}
              <button className="page-btn" disabled={currentPage >= Math.ceil(bookings.length / itemsPerPage)} onClick={() => setCurrentPage(p => p + 1)}><HiOutlineChevronRight /></button>
            </div>
          </div>
        </div>
      )}


      {/* Booking Detail Modal */}
      {detailModal && (
        <div className="modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="modal modal-viewing max-w-480" onClick={e => e.stopPropagation()}>
            <div className="modal-header pb-0">
              <h3 className="fs-24 fw-700">Chi tiết</h3>
              <button className="modal-close" onClick={() => setDetailModal(null)}>
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

            <div className="modal-body pt-0">
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
                          className={`form-input border-0 fs-16 fw-500 ${!detailEdit.service_id && detailEdit.service_search ? 'error' : ''}`}
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
                      <img src={clockIcon} alt="time" className="w-24" />
                    </div>
                    <div className="booking-row-content d-flex justify-content-between align-items-center">
                      <div className="booking-date-container">
                        <input
                          type="text"
                          className="form-input border-0 fs-16 fw-500 cursor-pointer"
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
                                    alert('Không thể chọn ngày trong quá khứ');
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
                      <div className="d-flex align-items-center">
                        <TimePickerInput
                          value={detailEdit.start_time}
                          onChange={val => handleTimeChange('start_time', val)}
                        />
                        <span className="fs-16 text-gray mx-4">—</span>
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
                          {detailEdit.customer_name?.trim().split(' ').at(-1)[0].toUpperCase() || 'C'}
                        </div>
                      ) : (
                        <img src={userIcon} alt="user" />
                      )}
                    </div>
                    <div className="booking-row-content">
                      {detailCustomerView === 'selected' && (
                        <div className="customer-info py-0 cursor-pointer" onClick={() => setDetailCustomerView('searching')}>
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
                                  <div className="customer-avatar">{c.name.trim().split(' ').at(-1)[0]}</div>
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
                      <img src={shopIcon} alt="branch" className="w-24" />
                    </div>
                    <div className="booking-row-content">
                      <select
                        className="form-select border-0 fs-16 fw-500"
                        value={detailEdit.branch_id}
                        onChange={e => {
                          const newBranchId = e.target.value;
                          setDetailEdit(f => ({ ...f, branch_id: newBranchId }));
                          loadEmployeesForDetail(newBranchId, detailEdit.booking_date);
                        }}
                      >
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <div className="customer-avatar bg-gray text-muted">{detailModal.employees?.name?.trim().split(' ').at(-1)[0] || 'A'}</div>
                    </div>
                    <div className="booking-row-content">
                      <div className="pos-relative">
                        <input
                          type="text"
                          className="form-input border-0 fs-16 fw-500"
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
                                <div className="customer-avatar">{emp.name.trim().split(' ').at(-1)[0]}</div>
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
                      <img src={noteIcon} alt="note" className="w-24" />
                    </div>
                    <div className="booking-row-content">
                      <input
                        type="text"
                        className="form-input border-0 fs-16 fw-500"
                        value={detailEdit.notes}
                        onChange={e => setDetailEdit(f => ({ ...f, notes: e.target.value }))}
                        placeholder="Thêm ghi chú"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="customer-view">
                  <div className="text-center my-14">
                    <p className='customer-id'>Mã KH: {detailModal.customers?.id}</p>
                    <div className="customer-avatar-lg mx-auto mb-16">
                      {detailEdit.customer_name?.trim().split(' ').at(-1)[0].toUpperCase() || 'A'}
                    </div>
                    <h2 className="fs-24 fw-700">{detailModal.customers?.name}</h2>
                  </div>

                  <div className="booking-row no-hover">
                    <div className="booking-row-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </div>
                    <div className="booking-row-content">
                      <input
                        className="form-input border-0 fs-16 fw-500"
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
                        className="form-input border-0 fs-16 fw-500"
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
                        className="form-input border-0 fs-16 text-gray"
                        value={detailEdit.customer_email}
                        onChange={e => setDetailEdit(f => ({ ...f, customer_email: e.target.value }))}
                        placeholder="Email"
                      />
                    </div>
                  </div>

                  <div className="booking-row no-hover align-items-start">
                    <div className="booking-row-icon">
                      <img src={noteIcon} alt="note" className="w-24 mt-32" />
                    </div>
                    <div className="booking-row-content">
                      <textarea
                        className="form-textarea border-0 fs-16 fw-500 h-60"
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
                <button className="btn-icon btn-more" onClick={() => setShowDetailMore(!showDetailMore)}>
                  <FiMoreVertical />
                </button>
                {showDetailMore && (
                  <div className="more-menu">
                    <button className="more-menu-item" onClick={handleDuplicate}>
                      Nhân bản
                    </button>
                    <button className="more-menu-item text-danger" onClick={() => handleCancel(detailModal.id)}>
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
                <button className="modal-close" onClick={() => setModalOpen(false)}>
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
                                    alert('Không thể chọn ngày trong quá khứ');
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
                      <div className="d-flex align-items-center">
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
                        <div className="customer-avatar customer-avatar-selected">{bookForm.customer_name?.trim().split(' ').at(-1)[0].toUpperCase() || 'A'}</div>
                      ) : (
                        <img src={userIcon} alt="user" />
                      )}
                    </div>
                    <div className="booking-row-content">
                      {customerView === 'default' && <div className="booking-row-title placeholder-text-dim cursor-pointer" onClick={() => setCustomerView('searching')}>Thêm Khách</div>}

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
                                  <div className="customer-avatar">{c.name.trim().split(' ').at(-1)[0]}</div>
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
                        <div className="customer-info py-0" onClick={() => setCustomerView('searching')}>
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
                      <div className="customer-avatar employee-avatar-placeholder">{bookForm.employee_search?.trim().split(' ').at(-1)[0] || 'A'}</div>
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
                                <div className="customer-avatar">{emp.name.trim().split(' ').at(-1)[0]}</div>
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
              <button className="modal-close" onClick={handleDragCancel}>
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
                  <span className="drag-confirm-staff-initial">{dragConfirm.fromStaff?.trim().split(' ').at(-1)?.[0]?.toUpperCase() || 'A'}</span>
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
                  <span className="drag-confirm-staff-initial">{dragConfirm.toStaff?.trim().split(' ').at(-1)?.[0]?.toUpperCase() || 'A'}</span>
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
