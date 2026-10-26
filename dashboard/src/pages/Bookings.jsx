import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'react-toastify';

import {
  getBookingsRange, createBooking, updateBooking, deleteBooking, checkInBooking,
  getBranches, getServices, getEmployees, getCustomers, getEmployeeSchedules,
  getSettings
} from '../api';

import { subscribeRealtime, REALTIME_RECONNECTED } from '../realtime';
import { shortBranchName } from '../utils/format';
import { isHoldBooking, isSpamWarningBooking } from '../utils/booking';
import { describeError } from '../utils/notify';
import { useConfirm } from '../components/ConfirmDialog';
import { useModalA11y } from '../hooks/useModalA11y';
import { useAppUI } from '../context/AppUIContext';
import { WALK_IN_CUSTOMER_NAME, TIME_PICKER_MIN_HOUR } from '../config/business';
import { useBusy } from '../hooks/useBusy';
import { useIsMobile, MOBILE_BREAKPOINT } from '../hooks/useIsMobile';
import {
  OPEN_HOUR, ROW_HEIGHT, UNASSIGNED_COLUMN_ID, toDateStr, timeToMinutes, normalize, normalizeName,
  WALK_IN_NORMALIZED, PLACEHOLDER_NORMALIZED, formatTime,
  getLogicalDate, convertYToTime, calculateEndTime
} from './bookings/helpers';
import BookingToolbar from './bookings/BookingToolbar';
import CalendarView from './bookings/CalendarView';
import BookingListView from './bookings/BookingListView';
import BookingDetailModal from './bookings/BookingDetailModal';
import CreateBookingModal from './bookings/CreateBookingModal';
import DragConfirmDialog from './bookings/DragConfirmDialog';
import '../styles/bookings.css';

function Bookings() {
  const confirmDialog = useConfirm();
  // Responsive: detect mobile for PWA
  const isMobile = useIsMobile();

  // Mobile mở mặc định ở list view, desktop ở calendar view (vẫn đổi được bằng nút toggle)
  const [viewMode, setViewMode] = useState(() => (window.innerWidth <= MOBILE_BREAKPOINT ? 'list' : 'calendar')); // 'calendar' | 'list'

  const [currentDate, setCurrentDate] = useState(getLogicalDate());

  const [bookings, setBookings] = useState([]);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]); // All active employees of filtered branch
  const [filterBranch, setFilterBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const loadBookingsRef = useRef(null);
  const { bookingsRefreshKey, gotoTarget, clearGotoTarget, askAI } = useAppUI();

  // AI chat vừa đổi lịch → tải lại. Bỏ qua lần mount đầu (trang tự tải) và các lần đã xử lý.
  const handledRefreshKeyRef = useRef(bookingsRefreshKey);
  useEffect(() => {
    if (bookingsRefreshKey === handledRefreshKeyRef.current) return;
    handledRefreshKeyRef.current = bookingsRefreshKey;
    // Gọi bản loadBookings MỚI NHẤT qua ref; tải lại cả lịch hẹn + nhân viên (AI có thể đổi tour trực).
    loadBookingsRef.current?.();
  }, [bookingsRefreshKey]);

  // Booking modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailEdit, setDetailEdit] = useState(null);
  // Mở từ thẻ nhóm (mobile): đổi ngày/giờ và hủy lịch áp dụng cho cả nhóm, không hỏi từng khách
  const [detailGroupMode, setDetailGroupMode] = useState(false);
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
  // Thao tác đang chạy (lưu / tạo / hủy / kéo-thả / tắt cảnh báo) → khóa nút + hiện "Đang ..."
  const { run, isBusy } = useBusy();
  // Drag-and-drop reorder state
  const [cardDrag, setCardDrag] = useState(null); // { booking, startCol, startTop }
  const [dragConfirm, setDragConfirm] = useState(null); // { booking, fromStaff, fromTime, toStaff, toTime, toStaffId, newDate, newStart, newEnd }
  const [dragSaving, setDragSaving] = useState(false); // popup kéo-thả đang lưu → khóa các nút
  // Drag-to-create state
  const [dragInfo, setDragInfo] = useState(null); // { startY, currentY, staffId, staffName, columnEl }
  const [hoverInfo, setHoverInfo] = useState(null); // { staffId, y, colLeft, colWidth }
  const [sysSettings, setSysSettings] = useState({});
  const calendarRef = useRef(null);
  const moreMenuRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const searchSeqRef = useRef(0);
  const bookFormInitialRef = useRef(''); // form lúc mở modal tạo lịch (JSON) — so sánh để biết đã sửa chưa
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
  // 'yyyy-mm-dd|branchId' của lần loadBookings gần nhất đã xong (dùng để biết khi nào nhảy tới lịch được)
  const [loadedKey, setLoadedKey] = useState(null);

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

  // ---- Nhảy tới lịch khi bấm thông báo (target đến từ AppUIContext) ----
  // Bước 1: chuyển sang đúng chi nhánh + ngày, giữ lại lịch cần tìm chờ dữ liệu của ngày đó tải xong.
  const [pendingGoto, setPendingGoto] = useState(null); // { bookingId, key: 'yyyy-mm-dd|branchId' }
  const suppressNowLineScrollRef = useRef(false);
  useEffect(() => {
    if (!gotoTarget) return;
    if (!gotoTarget.bookingId || !gotoTarget.bookingDate) {
      clearGotoTarget();
      return;
    }
    let targetBranchId = gotoTarget.branchId;
    if (!targetBranchId && gotoTarget.branchName) {
      if (branches.length === 0) return; // chờ tải danh sách chi nhánh để dò theo tên
      const wanted = shortBranchName(gotoTarget.branchName);
      targetBranchId = branches.find(b => shortBranchName(b.name) === wanted)?.id;
    }
    const branchId = targetBranchId || filterBranchRef.current;
    if (branchId && branchId !== filterBranchRef.current) setFilterBranch(branchId);

    suppressNowLineScrollRef.current = true; // không tự cuộn tới vạch "bây giờ" đè lên việc cuộn tới lịch
    setLoadedKey(null); // chờ lần tải MỚI của ngày/chi nhánh đích, không dùng dữ liệu đang hiển thị
    setCurrentDate(new Date(gotoTarget.bookingDate + 'T00:00:00'));
    setPendingGoto({ bookingId: gotoTarget.bookingId, key: `${gotoTarget.bookingDate}|${branchId || ''}` });
    clearGotoTarget();
  }, [gotoTarget, branches, clearGotoTarget]);

  // Bước 2: dữ liệu của đúng ngày/chi nhánh đã tải và hiển thị → cuộn tới lịch + tô sáng 3 giây
  useEffect(() => {
    if (!pendingGoto || loading || loadedKey !== pendingGoto.key) return;
    const { bookingId } = pendingGoto;
    setPendingGoto(null);
    // Thẻ gộp nhóm trên mobile chỉ mang id của lịch đầu → tìm thêm theo data-booking-ids
    const cardEl = document.getElementById(`booking-card-${bookingId}`)
      || document.querySelector(`[data-booking-ids~="${bookingId}"]`);
    if (!cardEl) {
      toast.info('Không tìm thấy lịch hẹn này trên màn hình (có thể đã bị hủy hoặc đổi sang ngày khác).');
      return;
    }
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cardEl.classList.add('highlight-appointment');
    setTimeout(() => cardEl.classList.remove('highlight-appointment'), 3000);
  }, [pendingGoto, loading, loadedKey, bookings]);

  // --- Drag-to-create: global mousemove/mouseup ---
  useEffect(() => {
    if (!dragInfo) return;

    const handleMouseMove = (e) => {
      const colRect = dragInfo.columnEl.getBoundingClientRect();
      const rawY = e.clientY - colRect.top;
      const snappedY = Math.max(dragInfo.startY, Math.ceil(rawY / 25) * 25);
      // Chỉ cập nhật khi sang ô mới (trả về prev → không render lại)
      setDragInfo(prev => (prev && prev.currentY !== snappedY ? { ...prev, currentY: snappedY } : prev));
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
        // Chỉ cập nhật khi sang cột / ô mới (trả về prev → không render lại)
        setCardDrag(prev => (
          prev && (prev.currentCol !== targetCol || prev.currentTop !== snappedY)
            ? { ...prev, currentCol: targetCol, currentTop: snappedY }
            : prev
        ));
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
      const origStaffId = cardDrag.booking.employee_id || cardDrag.booking.employees?.id || UNASSIGNED_COLUMN_ID;

      // Check if actually moved
      if (Math.abs(finalTop - origTop) < 5 && toStaffId === origStaffId) {
        // Not moved — treat as click, open detail
        handleOpenDetail(cardDrag.booking);
      } else {
        // Show confirmation popup
        const fromStart = formatTime(cardDrag.booking.start_time);
        const fromEnd = formatTime(cardDrag.booking.end_time);
        const bk = cardDrag.booking;
        setDragConfirm({
          booking: bk,
          fromStaff: fromStaffName,
          fromTime: `${fromStart} — ${fromEnd}`,
          toStaff: toStaffName,
          toTime: `${formatTime(newStart)} — ${formatTime(newEnd)}`,
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
  }, [cardDrag, currentDate, bookings]);

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

      // Dùng dạng hàm: nếu trong lúc chờ đã chọn chi nhánh (VD bấm thông báo) thì không ghi đè về chi nhánh đầu
      if (b.length > 0) {
        setFilterBranch(prev => prev || b[0].id);
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
      setLoadedKey(`${dayStr}|${filterBranch || ''}`);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('[bookings] Không tải được lịch hẹn:', err);
      // Không để lại dữ liệu của ngày/chi nhánh trước dưới tiêu đề mới → xóa và hiện thông báo lỗi + nút thử lại
      setBookings([]);
      setEmployees([]);
      setEmployeeSchedules([]);
      setLoadError(describeError(err));
      setLoadedKey(`${toDateStr(currentDate)}|${filterBranch || ''}`);
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
    // Đang nhảy tới một lịch từ thông báo → để việc cuộn tới lịch đó quyết định vị trí
    if (suppressNowLineScrollRef.current) {
      suppressNowLineScrollRef.current = false;
      return;
    }
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

  // Các lịch cùng nhóm khách (cùng group_booking_id) đang hiển thị trong ngày, kể cả chính lịch đó
  const getGroupMembers = (booking) => (
    booking?.group_booking_id ? bookings.filter(b => b.group_booking_id === booking.group_booking_id) : []
  );

  // Backend báo SCOPE_REQUIRED (lịch thuộc nhóm đổi field áp cho cả nhóm: ngày / giờ, chi nhánh, dịch vụ, ghi chú,
  // khách đặt; check-in) → hỏi, "Cả nhóm" là nút mặc định.
  // action = việc đang hỏi, VD "Check-in". Trả 'group' / 'booking' / null (không lưu)
  const askScope = async (groupSize, action = 'Áp dụng thay đổi') => {
    const choice = await confirmDialog({
      title: 'Lịch nhóm',
      message: `Lịch này thuộc nhóm ${groupSize} khách. ${action} cho cả nhóm hay chỉ khách này?`,
      confirmText: `Cả nhóm (${groupSize})`,
      altText: 'Chỉ khách này',
      cancelText: 'Không lưu'
    });
    if (!choice) return null;
    return choice === true ? 'group' : 'booking';
  };

  const notifySaved = (saved, fallbackMsg) => {
    const movedSiblings = saved?.group_updated_ids?.length || 0;
    notify(movedSiblings > 0 ? `Đã cập nhật cả nhóm ${movedSiblings + 1} khách!` : fallbackMsg);
    if (saved?.group_failed_count > 0) {
      toast.warn(`Có ${saved.group_failed_count} lịch trong nhóm chưa cập nhật được, vui lòng kiểm tra lại.`);
    }
  };

  const handleCancel = (id) => run('cancelFlow', async () => {
    const booking = bookings.find(b => b.id === id) || detailModal;
    const groupSize = getGroupMembers(booking).length;

    let group = false;
    if (groupSize > 1 && detailGroupMode && detailModal?.id === id) {
      if (!(await confirmDialog({ message: `Hủy lịch cho cả nhóm ${groupSize} khách?`, confirmText: `Hủy cả nhóm (${groupSize})`, cancelText: 'Không', danger: true }))) {
        return;
      }
      group = true;
    } else if (groupSize > 1) {
      const choice = await confirmDialog({
        title: 'Hủy lịch nhóm',
        message: `Lịch này thuộc nhóm ${groupSize} khách. Hủy cả nhóm hay chỉ khách này?`,
        confirmText: `Hủy cả nhóm (${groupSize})`,
        altText: 'Chỉ khách này',
        cancelText: 'Không',
        danger: true
      });
      if (!choice) return;
      group = choice === true;
    } else if (!(await confirmDialog({ message: 'Bạn có chắc muốn hủy lịch hẹn này?', confirmText: 'Hủy lịch', cancelText: 'Không', danger: true }))) {
      return;
    }

    await run('cancel', async () => {
      try {
        await deleteBooking(id, { group });
        notify(group ? `Đã hủy cả nhóm ${groupSize} khách!` : 'Đã hủy lịch hẹn thành công!');
        loadBookings();
        setDetailModal(null);
        setShowDetailMore(false);
      } catch (err) {
        toast.error(err.message);
      }
    });
  });

  // --- Context menu khi giữ lâu thẻ lịch (mobile list view). item = 1 phần tử của mobileListItems ---
  const handleCheckInItem = (item) => run(`checkin:${item.key}`, async () => {
    try {
      // Lịch thuộc nhóm → backend báo SCOPE_REQUIRED → hỏi "Cả nhóm / Chỉ khách này" rồi gửi lại kèm scope.
      // Khách trễ chồng lên lịch kế tiếp / quá giờ nhận khách + thời gian chờ → hỏi "Vẫn lưu?"
      const checkIn = (scope) => saveConfirmingConflict(allow => checkInBooking(item.lead.id, {
        ...(scope && { scope }),
        ...(allow && { allow_conflict: true })
      }));
      let checkedIn;
      try {
        checkedIn = await checkIn();
      } catch (err) {
        if (err?.status !== 409 || err.data?.code !== 'SCOPE_REQUIRED') throw err;
        const scope = await askScope(err.data.group_size, 'Check-in');
        if (!scope) return;
        checkedIn = await checkIn(scope);
      }
      if (!checkedIn) return;
      notify(checkedIn.checked_in > 1 ? `Đã báo cả nhóm ${checkedIn.checked_in} khách tới!` : 'Đã báo khách tới!');
      loadBookings();
    } catch (err) {
      toast.error(err.message);
    }
  });

  const handleCancelItem = (item) => run(`cancel:${item.key}`, async () => {
    const group = item.guestCount > 1;
    const ok = await confirmDialog({
      message: group ? `Hủy lịch cho cả nhóm ${item.guestCount} khách?` : 'Bạn có chắc muốn hủy lịch hẹn này?',
      confirmText: group ? `Hủy cả nhóm (${item.guestCount})` : 'Hủy lịch',
      cancelText: 'Không',
      danger: true
    });
    if (!ok) return;
    try {
      await deleteBooking(item.lead.id, { group });
      notify(group ? `Đã hủy cả nhóm ${item.guestCount} khách!` : 'Đã hủy lịch hẹn thành công!');
      loadBookings();
    } catch (err) {
      toast.error(err.message);
    }
  });

  const handleAskAIItem = (item) => askAI({
    bookingIds: item.ids,
    label: `${item.lead.temporary_name || item.lead.customers?.name || 'Lịch hẹn'} · ${formatTime(item.lead.start_time)}${item.guestCount > 1 ? ` · ${item.guestCount} khách` : ''}`
  });

  // --- Drag-to-create helpers ---
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
    const colLeft = rect.left - gridRect.left;
    const colWidth = rect.width;

    // Chỉ cập nhật khi chuột sang ô 15 phút / cột khác. Trả về `prev` → React bỏ qua render,
    // tránh render lại cả lưới lịch ở mỗi pixel rê chuột.
    setHoverInfo(prev => (
      prev && prev.staffId === emp.id && prev.y === snappedY && prev.colLeft === colLeft && prev.colWidth === colWidth
        ? prev
        : { staffId: emp.id, y: snappedY, colLeft, colWidth, time: convertYToTime(snappedY) }
    ));
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

  // Tạo / sửa / kéo thả / check-in: backend báo vướng mắc (409 BOOKING_CONFLICT: NV bận, ngoài ca, hết giường,
  // không còn ai rảnh) → liệt kê đủ lý do, hỏi "Vẫn lưu?" rồi gọi lại với allowConflict = true.
  // save(allowConflict) → Promise. Trả về kết quả đã lưu, hoặc null nếu người dùng chọn không lưu.
  const saveConfirmingConflict = async (save) => {
    try {
      return await save(false);
    } catch (err) {
      if (err?.status !== 409 || err.data?.code !== 'BOOKING_CONFLICT') throw err;
      // Dời cả nhóm: backend ghi kèm guest_name → nói rõ vướng mắc của khách nào
      const reasons = [...new Set((err.data.conflicts || []).map(c => {
        const reason = c.message || `${c.customer_name}: ${formatTime(c.start_time)} - ${formatTime(c.end_time)}`;
        return c.guest_name ? `${c.guest_name}: ${reason}` : reason;
      }))];
      const keepSaving = await confirmDialog({
        title: 'Cần xác nhận',
        message: `${reasons.map(r => `• ${r}`).join('\n')}\n\nVẫn lưu?`,
        confirmText: 'Vẫn lưu',
        cancelText: 'Không lưu'
      });
      if (!keepSaving) return null;
      return await save(true);
    }
  };

  // Sửa / kéo thả: lịch thuộc nhóm đổi ngày / giờ → backend báo 409 SCOPE_REQUIRED (kèm group_size) → hỏi
  // "Cả nhóm / Chỉ khách này" rồi gửi lại kèm scope. Backend quyết định khi nào cần hỏi, dashboard không tự đoán.
  const updateBookingConfirmingConflict = async (id, payload) => {
    try {
      return await saveConfirmingConflict(allow => updateBooking(id, allow ? { ...payload, allow_conflict: true } : payload));
    } catch (err) {
      if (err?.status !== 409 || err.data?.code !== 'SCOPE_REQUIRED' || payload.scope) throw err;
      const scope = await askScope(err.data.group_size);
      if (!scope) return null;
      return await updateBookingConfirmingConflict(id, { ...payload, scope });
    }
  };

  const handleDragConfirm = () => run('dragConfirm', async () => {
    if (!dragConfirm) return;
    setDragSaving(true);
    try {
      const bk = dragConfirm.booking;
      const saved = await updateBookingConfirmingConflict(bk.id, {
        service_id: bk.service_id || bk.services?.id,
        branch_id: bk.branch_id || bk.branches?.id,
        employee_id: dragConfirm.toStaffId === UNASSIGNED_COLUMN_ID ? null : dragConfirm.toStaffId,
        start_time: dragConfirm.newStart,
        end_time: dragConfirm.newEnd,
        booking_date: dragConfirm.newDate
      });
      if (saved) {
        notifySaved(saved, 'Đã cập nhật lịch hẹn!');
        loadBookings();
      }
    } catch (err) {
      toast.error('Lỗi: ' + err.message);
    }
    setDragConfirm(null);
    setDragSaving(false);
  });

  // Đang lưu thay đổi kéo-thả → không cho đóng popup (bấm ra ngoài / Esc / "Hủy, giữ nguyên")
  const handleDragCancel = () => {
    if (isBusy('dragConfirm')) return;
    setDragConfirm(null);
  };

  // ---- Booking Modal Logic ----
  const openBookingModal = (preDate, preEmployee, preStartTime, preEndTime) => {
    const initialForm = {
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
    };
    setBookForm(initialForm);
    bookFormInitialRef.current = JSON.stringify(initialForm); // để biết form đã bị sửa chưa khi đóng
    setCustomerView('default');
    setSelectedService(null);
    setModalOpen(true);
  };

  const handleDuplicate = () => {
    if (!detailModal || !detailEdit) return;

    // Copy data from detailEdit
    const service = services.find(s => s.id === detailEdit.service_id);
    // const employee = employees.find(e => e.id === detailEdit.employee_id);

    const initialForm = {
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
    };
    setBookForm(initialForm);
    bookFormInitialRef.current = JSON.stringify(initialForm);

    setCustomerView('selected');

    setSelectedService(service);
    setDetailModal(null);
    setModalOpen(true);
    setShowDetailMore(false);
  };

  // ---- Đóng modal (Esc / bấm ra ngoài) ----
  const clearSuggestions = () => setSearchSuggestions({ type: null, data: [], loading: false });

  // Đóng popover bên trong trước (lịch chọn ngày, gợi ý tìm kiếm, menu "..."), rồi mới đóng modal
  const closeInnerPopover = () => {
    if (showCalendar) { setShowCalendar(false); return true; }
    if (searchSuggestions.type) { clearSuggestions(); return true; }
    if (showDetailMore) { setShowDetailMore(false); return true; }
    return false;
  };

  const handleDetailModalEscape = () => {
    if (!closeInnerPopover()) setDetailModal(null);
  };

  // Modal tạo lịch: form đã bị sửa → hỏi trước khi bỏ (bấm ra ngoài / Esc). Nút X vẫn đóng ngay.
  const requestCloseBookModal = async () => {
    const dirty = JSON.stringify(bookForm) !== bookFormInitialRef.current;
    if (dirty && !(await confirmDialog({
      message: 'Lịch đang nhập chưa được lưu. Bỏ lịch này?',
      confirmText: 'Bỏ lịch',
      cancelText: 'Tiếp tục nhập',
      danger: true
    }))) return;
    setModalOpen(false);
  };

  const handleBookModalEscape = () => {
    if (!closeInnerPopover()) requestCloseBookModal();
  };

  const detailModalRef = useModalA11y(!!detailModal, handleDetailModalEscape);
  const bookModalRef = useModalA11y(modalOpen, handleBookModalEscape);
  const dragConfirmRef = useModalA11y(!!dragConfirm, handleDragCancel);


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

  const handleBookSubmit = (e) => {
    e.preventDefault();
    // Khóa ngay từ đầu (kể cả bước tìm "Khách lạ") → bấm "Tạo" liên tục không sinh nhiều lịch trùng
    return run('create', () => submitBooking());
  };

  const submitBooking = async () => {
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

      // NV được chọn bận / ngoài ca, hết giường, không còn ai rảnh → hỏi "Vẫn lưu?" (giữ đúng NV đã chọn)
      const created = await saveConfirmingConflict(allow => createBooking(allow ? { ...finalForm, allow_conflict: true } : finalForm));
      if (!created) return; // chọn không lưu → giữ form để chỉnh tiếp
      notify('Đặt lịch thành công!');
      setModalOpen(false);
      loadBookings();
    } catch (err) {
      toast.error('Lỗi: ' + err.message);
    }
  };

  // 'saveDetailFlow' khóa cả luồng (kể cả lúc hỏi dời nhóm); 'saveDetail' chỉ phần gửi lên server → nút hiện "Đang cập nhật..."
  const handleSaveDetail = () => run('saveDetailFlow', async () => {
    if (!detailModal || !detailEdit) return;

    // Nhân viên có thể để trống = lịch chưa xếp NV (cột "Chưa xếp NV")
    if (!detailEdit.service_id || !detailEdit.branch_id || !detailEdit.start_time) {
      toast.warn('Vui lòng chọn đầy đủ: dịch vụ, chi nhánh, giờ');
      return;
    }

    await run('saveDetail', async () => {
      try {
        // 1. Update Booking
        const bookingUpdate = {
          service_id: detailEdit.service_id,
          branch_id: detailEdit.branch_id,
          start_time: detailEdit.start_time,
          booking_date: detailEdit.booking_date,
          end_time: detailEdit.end_time,
          employee_id: detailEdit.employee_id || null,
          notes: detailEdit.notes,
          customer_id: detailEdit.customer_id || null
        };
        // Mở chi tiết từ thẻ nhóm (đã chọn cả nhóm) → gửi luôn scope 'group', không hỏi lại.
        // Còn lại: lịch thuộc nhóm đổi ngày / giờ thì backend báo SCOPE_REQUIRED → hỏi (updateBookingConfirmingConflict)
        if (detailGroupMode && getGroupMembers(detailModal).length > 1) bookingUpdate.scope = 'group';

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

        notifySaved(updated, 'Cập nhật thành công!');

        setDetailModal(null);
      } catch (err) {
        toast.error(err.message);
      }
    });
  });

  const handleOpenDetail = async (booking, { groupMode = false } = {}) => {
    // Prevent opening detail view for temporary slot holds
    if (isHoldBooking(booking)) return;

    cancelDetailAvailabilityCheck();
    setDetailModal(booking);
    setDetailGroupMode(groupMode && getGroupMembers(booking).length > 1);

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

  // Giờ đã nhập xong? Ô giờ báo onChange theo TỪNG phím: đang gõ "14" sẽ đi qua "01:30", xóa ô thì thành "--:30".
  // Các giá trị dở dang đó không phải giờ thật → không đem đi kiểm tra ca (trước đây bị coi là ngoài ca).
  const isCompleteTime = (t) => {
    if (!/^\d{2}:\d{2}$/.test(t || '')) return false;
    return timeToMinutes(t) >= TIME_PICKER_MIN_HOUR * 60; // giờ nhỏ hơn giờ tối thiểu = đang gõ dở (ô giờ tự sửa khi rời ô)
  };

  const checkStaffAvailability = async (empId, date, start, end) => {
    if (!empId || !date || !isCompleteTime(start) || !isCompleteTime(end)) return true;
    try {
      const resp = await getEmployeeSchedules({
        employee_id: empId,
        date_from: date,
        date_to: date
      });
      const startMin = timeToMinutes(start);
      const endMin = timeToMinutes(end);
      // Một ngày có thể có nhiều ca → hợp lệ khi lọt trọn trong ít nhất một ca làm việc
      return (resp || []).some(sched => {
        if (sched.is_day_off || !sched.start_time || !sched.end_time) return false;
        const sStart = timeToMinutes(String(sched.start_time).substring(0, 5));
        const sEnd = timeToMinutes(String(sched.end_time).substring(0, 5));
        return startMin >= sStart && endMin <= sEnd;
      });
    } catch (err) {

      return true;
    }
  };

  // Kiểm tra ca của nhân viên sau khi sửa ngày/giờ trong modal chi tiết.
  // - Chờ người dùng ngừng gõ 400ms rồi mới gọi API (không bắn 1 request mỗi phím).
  // - Chỉ áp kết quả của lần kiểm tra MỚI NHẤT và khi form vẫn đúng ngày/giờ/nhân viên đã kiểm tra:
  //   trước đây kết quả của giá trị gõ dở ("01:30") về sau vẫn xóa nhân viên dù giờ cuối cùng hợp lệ.
  const detailEditRef = useRef(detailEdit);
  detailEditRef.current = detailEdit;
  const availabilityCheckRef = useRef({ seq: 0, timer: null });

  const cancelDetailAvailabilityCheck = () => {
    const ref = availabilityCheckRef.current;
    ref.seq++;
    clearTimeout(ref.timer);
  };

  const scheduleDetailAvailabilityCheck = (next, message) => {
    cancelDetailAvailabilityCheck();
    const ref = availabilityCheckRef.current;
    const seq = ref.seq;
    ref.timer = setTimeout(async () => {
      const isAvail = await checkStaffAvailability(next.employee_id, next.booking_date, next.start_time, next.end_time);
      const cur = detailEditRef.current;
      if (isAvail || seq !== ref.seq || !cur) return;
      const sameInput = ['employee_id', 'booking_date', 'start_time', 'end_time'].every(k => cur[k] === next[k]);
      if (!sameInput) return;
      // Giữ đúng NV đã chọn (ROADMAP P0) — chỉ báo trước; bấm Lưu thì backend hỏi "Vẫn lưu?"
      toast.warn(`${message} Khi lưu sẽ hỏi xác nhận.`, { position: 'bottom-right' });
    }, 400);
  };

  // Đóng modal / rời trang → bỏ lượt kiểm tra đang chờ
  useEffect(() => {
    if (!detailModal) cancelDetailAvailabilityCheck();
  }, [detailModal]);
  useEffect(() => () => cancelDetailAvailabilityCheck(), []);

  const handleDateChange = (newDate) => {
    const updated = { ...detailEdit, booking_date: newDate };
    setDetailEdit(prev => ({ ...prev, booking_date: newDate }));
    scheduleDetailAvailabilityCheck(updated, 'Nhân viên không làm việc hoặc không có ca trực vào ngày đã chọn.');
  };

  const handleTimeChange = (type, newVal) => {
    const updated = { ...detailEdit, [type]: newVal };
    if (type === 'start_time') {
      const duration = services.find(s => s.id === detailEdit.service_id)?.duration_minutes || 0;
      updated.end_time = calculateEndTime(newVal, duration);
    }
    setDetailEdit(updated);
    scheduleDetailAvailabilityCheck(updated, 'Nhân viên không làm việc hoặc không có ca trực vào khung giờ mới.');
  };

  const isDetailModified = useMemo(() => {
    if (!detailModal || !detailEdit) return false;
    return (
      detailEdit.service_id !== (detailModal.service_id || detailModal.services?.id) ||
      detailEdit.branch_id !== (detailModal.branch_id || detailModal.branches?.id) ||
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

  const handleDismissWarning = (e, booking) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    // Lịch giữ chỗ tạm thời: xóa internal_note sẽ khiến job dọn giữ chỗ không nhận ra → chiếm slot vĩnh viễn
    if (!booking || isHoldBooking(booking)) return;

    return run(`dismiss:${booking.id}`, async () => {
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
        // Cảnh báo chống spam gắn với cả lần đặt online → tắt cho cả nhóm, không hỏi "Cả nhóm / Chỉ khách này"
        if (getGroupMembers(booking).length > 1) bookingUpdate.scope = 'group';

        await updateBooking(booking.id, bookingUpdate);

        if (detailModal && detailModal.id === booking.id) {
          setDetailEdit(prev => ({ ...prev, internal_note: '' }));
        }

        notify('Đã tắt cảnh báo và khôi phục màu dịch vụ!');
        loadBookings();
      } catch (err) {

        toast.error('Không thể tắt cảnh báo: ' + err.message);
      }
    });
  };


  const todayStr = toDateStr(new Date());
  const isToday = toDateStr(currentDate) === todayStr;

  // Lịch theo từng nhân viên cho lưới lịch — tính lại chỉ khi danh sách lịch đổi (trước đây lọc lại cho
  // mọi cột ở mỗi lần render). Cùng điều kiện cũ: khớp employee_id HOẶC employees.id; giữ nguyên thứ tự.
  // Lịch chưa xếp NV (nhân viên "Vẫn lưu" khi không còn ai rảnh) → gom vào cột riêng UNASSIGNED_COLUMN_ID.
  const bookingsByEmployee = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const ids = new Set([b.employee_id, b.employees?.id].filter(Boolean));
      if (ids.size === 0) ids.add(UNASSIGNED_COLUMN_ID);
      for (const id of ids) {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(b);
      }
    }
    return map;
  }, [bookings]);

  // Cột "Chưa xếp NV" chỉ hiện khi ngày đang xem có lịch chưa xếp NV. Không có ca → không kéo tạo lịch mới vào được,
  // nhưng vẫn kéo thẻ ra cột nhân viên (= xếp NV) hoặc thả vào (= bỏ NV) được.
  const calendarEmployees = useMemo(() => (
    bookingsByEmployee.has(UNASSIGNED_COLUMN_ID)
      ? [...employees, { id: UNASSIGNED_COLUMN_ID, name: 'Chưa xếp NV' }]
      : employees
  ), [employees, bookingsByEmployee]);

  // Vị trí từng lịch trong nhóm khách → chip "1/3" trên lưới lịch và bảng.
  // Thứ tự trong nhóm: giờ bắt đầu, rồi thứ tự cột nhân viên. Nhóm chỉ còn 1 lịch thì không hiện chip.
  const groupInfoById = useMemo(() => {
    const byGroup = new Map();
    for (const b of bookings) {
      if (!b.group_booking_id) continue;
      if (!byGroup.has(b.group_booking_id)) byGroup.set(b.group_booking_id, []);
      byGroup.get(b.group_booking_id).push(b);
    }
    const empOrder = new Map(employees.map((e, i) => [e.id, i]));
    const info = new Map();
    for (const [groupId, members] of byGroup) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) =>
        (a.start_time || '').localeCompare(b.start_time || '') ||
        (empOrder.get(a.employee_id) ?? Infinity) - (empOrder.get(b.employee_id) ?? Infinity)
      );
      sorted.forEach((m, i) => info.set(m.id, { groupId, index: i + 1, size: sorted.length }));
    }
    return info;
  }, [bookings, employees]);

  // List view ẩn lịch khách đã đến (status arrived); calendar vẫn hiện đầy đủ
  const listBookings = useMemo(() => bookings.filter(b => b.status !== 'arrived'), [bookings]);

  // Mobile list view: gộp các lịch cùng group_booking_id (khách đi nhóm) thành 1 card
  const mobileListItems = useMemo(() => {
    const groups = new Map();
    for (const b of listBookings) {
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
      const statuses = unique(sorted.map(m => m.status));
      return {
        key,
        lead,
        members: sorted,
        ids: sorted.map(m => m.id),
        guestCount: sorted.length,
        // Trạng thái chung: tất cả giống nhau → trạng thái đó, khác nhau → 'mixed'
        status: statuses.length === 1 ? statuses[0] : 'mixed',
        hasSpamWarning: sorted.some(isSpamWarningBooking),
        isHold: sorted.every(isHoldBooking),
        endTime,
        serviceNames: unique(sorted.map(m => m.services?.name)).join(' + '),
        notes: unique(sorted.map(m => m.notes)),
        internalNotes: unique(sorted.map(m => m.internal_note))
      };
    }).sort((a, b) => byStart(a.lead, b.lead));
  }, [listBookings]);

  return (
    <div className='full-view full-view-bookings' style={{ '--staff-count': loading ? 3 : (calendarEmployees.length || 1) }}>
      {/* Calendar Toolbar */}
      <BookingToolbar
        branches={branches}
        currentDate={currentDate}
        employeeSchedules={employeeSchedules}
        employees={calendarEmployees}
        filterBranch={filterBranch}
        goNext={goNext}
        goPrev={goPrev}
        goToday={goToday}
        isMobile={isMobile}
        isToday={isToday}
        loading={loading}
        openBookingModal={openBookingModal}
        setFilterBranch={setFilterBranch}
        setViewMode={setViewMode}
        viewMode={viewMode}
      />

      {/* Calendar View */}
      {viewMode === 'calendar' ? (
        <CalendarView
          bookingsByEmployee={bookingsByEmployee}
          branches={branches}
          cardDrag={cardDrag}
          currentDate={currentDate}
          dragInfo={dragInfo}
          employeeSchedules={employeeSchedules}
          employees={calendarEmployees}
          filterBranch={filterBranch}
          gridRef={gridRef}
          groupInfoById={groupInfoById}
          handleCardDragStart={handleCardDragStart}
          handleColumnHover={handleColumnHover}
          handleDragStart={handleDragStart}
          handleRetryLoad={handleRetryLoad}
          hoverInfo={hoverInfo}
          loadError={loadError}
          loading={loading}
          now={now}
          nowLineRef={nowLineRef}
          setHoverInfo={setHoverInfo}
        />
      ) : (
        /* List View */
        <BookingListView
          bookings={listBookings}
          groupInfoById={groupInfoById}
          handleAskAIItem={handleAskAIItem}
          handleCancelItem={handleCancelItem}
          handleCheckInItem={handleCheckInItem}
          handleOpenDetail={handleOpenDetail}
          handleRetryLoad={handleRetryLoad}
          isMobile={isMobile}
          loadError={loadError}
          loading={loading}
          mobileListItems={mobileListItems}
        />
      )}


      {/* Booking Detail Modal */}
      <BookingDetailModal
        branches={branches}
        calendarRef={calendarRef}
        detailCustomerView={detailCustomerView}
        detailEdit={detailEdit}
        detailModal={detailModal}
        detailModalRef={detailModalRef}
        detailGroupSize={detailGroupMode ? getGroupMembers(detailModal).length : 0}
        detailSaving={isBusy('saveDetail')}
        detailBusy={isBusy('saveDetailFlow') || isBusy('cancelFlow')}
        cancelling={isBusy('cancel')}
        dismissingWarning={!!detailModal && isBusy(`dismiss:${detailModal.id}`)}
        detailTab={detailTab}
        handleCancel={handleCancel}
        handleDateChange={handleDateChange}
        handleDismissWarning={handleDismissWarning}
        handleDuplicate={handleDuplicate}
        handleGenericSearch={handleGenericSearch}
        handleSaveDetail={handleSaveDetail}
        handleSelectSuggestion={handleSelectSuggestion}
        handleTimeChange={handleTimeChange}
        isDetailModified={isDetailModified}
        moreMenuRef={moreMenuRef}
        searchSuggestions={searchSuggestions}
        services={services}
        setDetailCustomerView={setDetailCustomerView}
        setDetailEdit={setDetailEdit}
        setDetailModal={setDetailModal}
        setDetailTab={setDetailTab}
        setSearchSuggestions={setSearchSuggestions}
        setShowCalendar={setShowCalendar}
        setShowDetailMore={setShowDetailMore}
        showCalendar={showCalendar}
        showDetailMore={showDetailMore}
      />

      {/* Create Booking Modal */}
      <CreateBookingModal
        bookForm={bookForm}
        bookModalRef={bookModalRef}
        branches={branches}
        calendarRef={calendarRef}
        checkStaffAvailability={checkStaffAvailability}
        customerView={customerView}
        handleBookSubmit={handleBookSubmit}
        handleGenericSearch={handleGenericSearch}
        handleSelectSuggestion={handleSelectSuggestion}
        isCreating={isBusy('create')}
        modalOpen={modalOpen}
        requestCloseBookModal={requestCloseBookModal}
        searchSuggestions={searchSuggestions}
        selectedService={selectedService}
        setBookForm={setBookForm}
        setCustomerView={setCustomerView}
        setModalOpen={setModalOpen}
        setSearchSuggestions={setSearchSuggestions}
        setShowCalendar={setShowCalendar}
        showCalendar={showCalendar}
      />

      {/* Drag & Drop Confirmation Popup */}
      <DragConfirmDialog
        dragConfirm={dragConfirm}
        dragConfirmRef={dragConfirmRef}
        handleDragCancel={handleDragCancel}
        handleDragConfirm={handleDragConfirm}
        dragSaving={dragSaving}
      />
    </div >
  );
}

export default Bookings;
