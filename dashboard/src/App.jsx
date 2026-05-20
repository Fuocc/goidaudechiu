import 'react-toastify/dist/ReactToastify.css';
import { ToastContainer } from 'react-toastify';
import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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
import Sidebar from './components/Sidebar';

function App() {
  const { isLoaded, userId, getToken, signOut } = useAuth();
  const { user } = useUser();

  const userRole = user?.publicMetadata?.role || 'admin'; // Default to admin or read from Clerk metadata

  useEffect(() => {
    if (isLoaded && userId) {
      // Fetch Clerk JWT and update localStorage
      getToken().then(token => {
        if (token) {
          localStorage.setItem('sb_access_token', token);
        }
      });

      // Keep token fresh
      const interval = setInterval(() => {
        getToken().then(token => {
          if (token) {
            localStorage.setItem('sb_access_token', token);
          }
        });
      }, 60 * 1000);

      return () => clearInterval(interval);
    } else if (isLoaded && !userId) {
      localStorage.removeItem('sb_access_token');
    }
  }, [isLoaded, userId, getToken]);

  const handleLogout = async () => {
    await signOut();
    localStorage.removeItem('sb_access_token');
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

  return (
    <div className="app-layout">
      <Sidebar user={user} onLogout={handleLogout} />
      <div className="main-content">
        <div className="page-content">
          <Routes>
            <Route path="/" element={<Bookings />} />
            <Route path="/customers" element={<Customers />} />

            {userRole === 'admin' && (
              <>
                <Route path="/employees" element={<Employees />} />
                <Route path="/services" element={<Services />} />
                <Route path="/branches" element={<Branches />} />
                <Route path="/schedules" element={<EmployeeSchedules />} />
                <Route path="/settings" element={<Settings />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
