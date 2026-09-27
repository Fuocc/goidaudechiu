import 'react-toastify/dist/ReactToastify.css';
import { ToastContainer } from 'react-toastify';
import { useLayoutEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/clerk-react';
import Login from './pages/Login';
// import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Employees from './pages/Employees';
import Services from './pages/Services';
import Bookings from './pages/Bookings';
import Branches from './pages/Branches';
import EmployeeSchedules from './pages/EmployeeSchedules';
import Settings from './pages/Settings';
import ShareLink from './pages/ShareLink';
import Sidebar from './components/Sidebar';
import UserSettings from './pages/UserSettings';
import ErrorBoundary from './components/ErrorBoundary';
import { setAuthTokenGetter } from './api';

const VALID_ROLES = ['staff', 'admin', 'dev'];

function App() {
  const { isLoaded, userId, getToken, signOut } = useAuth();
  const { user } = useUser();
  const location = useLocation();

  // Role đặt trong Clerk → Users → Public metadata. Không có role hợp lệ → không cho vào (backend cũng từ chối).
  const userRole = user?.publicMetadata?.role;
  const isAdmin = userRole === 'admin' || userRole === 'dev';

  // Mỗi request API tự lấy token mới nhất từ Clerk (không lưu token vào localStorage).
  // useLayoutEffect (không phải useEffect): React chạy mọi layout effect trước useEffect của component con
  // trong cùng lần commit → getter đã sẵn sàng khi Bookings/Sidebar gọi API lần đầu (tránh loạt 401 + retry).
  useLayoutEffect(() => {
    setAuthTokenGetter(userId ? (opts) => getToken(opts) : null);
    // Dọn token cũ do phiên bản trước lưu lại
    try { localStorage.removeItem('sb_access_token'); } catch (e) { /* ignore */ }
  }, [userId, getToken]);

  const handleLogout = async () => {
    setAuthTokenGetter(null);
    await signOut();
  };

  if (!isLoaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: '#afafaf' }}>Đang tải...</p>
      </div>
    );
  }

  if (!userId) {
    return <Login />;
  }

  if (user && !VALID_ROLES.includes(userRole)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 16, padding: 24, textAlign: 'center' }}>
        <p style={{ color: '#57534E' }}>Tài khoản của bạn chưa được cấp quyền truy cập. Vui lòng liên hệ quản trị viên.</p>
        <button className="btn btn-primary" onClick={handleLogout}>Đăng xuất</button>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar user={user} onLogout={handleLogout} />
      <div className="main-content">
        <div className="page-content">
          <ErrorBoundary resetKey={location.pathname}>
            <Routes>
              <Route path="/" element={<Bookings />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/user-settings" element={<UserSettings />} />

              {isAdmin && (
                <>
                  <Route path="/employees" element={<Employees />} />
                  <Route path="/services" element={<Services />} />
                  <Route path="/branches" element={<Branches />} />
                  <Route path="/schedules" element={<EmployeeSchedules />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/share-link" element={<ShareLink />} />
                </>
              )}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </div>
      <ToastContainer
        position="bottom-right"
        hideProgressBar={false}
        autoClose={2500}
      />
    </div>
  );
}

export default App;
