import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Giao tiếp giữa các phần của app (thay cho window.dispatchEvent + sessionStorage trước đây):
 *  - refreshBookings(): AI chat vừa đổi lịch → trang Lịch hẹn tải lại (theo dõi bookingsRefreshKey)
 *  - gotoBooking(target): bấm thông báo → trang Lịch hẹn chuyển tới đúng chi nhánh/ngày rồi cuộn tới lịch.
 *    Target nằm trong context nên vẫn còn khi trang Lịch hẹn được mở sau (đang ở trang khác).
 */
const AppUIContext = createContext(null);

export function AppUIProvider({ children }) {
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);
  const [gotoTarget, setGotoTarget] = useState(null); // { bookingId, bookingDate, branchId, branchName? }

  const refreshBookings = useCallback(() => setBookingsRefreshKey(k => k + 1), []);
  const gotoBooking = useCallback((target) => setGotoTarget({ ...target }), []);
  const clearGotoTarget = useCallback(() => setGotoTarget(null), []);

  const value = useMemo(
    () => ({ bookingsRefreshKey, refreshBookings, gotoTarget, gotoBooking, clearGotoTarget }),
    [bookingsRefreshKey, refreshBookings, gotoTarget, gotoBooking, clearGotoTarget]
  );

  return <AppUIContext.Provider value={value}>{children}</AppUIContext.Provider>;
}

export function useAppUI() {
  const ctx = useContext(AppUIContext);
  if (!ctx) throw new Error('useAppUI phải được dùng bên trong <AppUIProvider>');
  return ctx;
}
