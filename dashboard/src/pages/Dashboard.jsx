import { useState, useEffect } from 'react';
import { FiCalendar, FiDollarSign, FiUsers, FiTrendingUp } from 'react-icons/fi';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { getDashboardStats, getRevenueChart, getTopServices } from '../api';
import '../styles/dashboard.css';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [revenueData, setRevenueData] = useState([]);
  const [topServices, setTopServices] = useState([]);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, chartData, servicesData] = await Promise.all([
        getDashboardStats({ period }),
        getRevenueChart({ days: period === 'week' ? 7 : period === 'month' ? 30 : 365 }),
        getTopServices()
      ]);
      setStats(statsData);
      setRevenueData(chartData);
      setTopServices(servicesData.slice(0, 5));
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (val) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
    return val?.toLocaleString('vi-VN') || '0';
  };

  const formatFullPrice = (val) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val || 0);
  };

  const formatChartDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Trang chủ</h1>
          <p className="page-subtitle">Tổng quan hoạt động spa</p>
        </div>
        <div className="d-flex gap-8">
          {['today', 'week', 'month', 'year'].map(p => (
            <button
              key={p}
              className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPeriod(p)}
            >
              {p === 'today' ? 'Hôm nay' : p === 'week' ? 'Tuần' : p === 'month' ? 'Tháng' : 'Năm'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><FiCalendar /></div>
          <div className="stat-label">Lịch hẹn hôm nay</div>
          <div className="stat-value">{stats?.today_bookings || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><FiDollarSign /></div>
          <div className="stat-label">Doanh thu</div>
          <div className="stat-value">{formatPrice(stats?.total_revenue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><FiTrendingUp /></div>
          <div className="stat-label">Tổng lịch hẹn</div>
          <div className="stat-value">{stats?.total_bookings || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><FiUsers /></div>
          <div className="stat-label">Tổng khách hàng</div>
          <div className="stat-value">{stats?.total_customers || 0}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Doanh thu theo ngày</h3>
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#000000" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#000000" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#efefef" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatChartDate}
                  tick={{ fontSize: 12, fill: '#afafaf' }}
                  axisLine={{ stroke: '#efefef' }}
                />
                <YAxis
                  tickFormatter={(v) => formatPrice(v)}
                  tick={{ fontSize: 12, fill: '#afafaf' }}
                  axisLine={{ stroke: '#efefef' }}
                />
                <Tooltip
                  formatter={(val) => [formatFullPrice(val), 'Doanh thu']}
                  labelFormatter={(l) => `Ngày ${formatChartDate(l)}`}
                  contentStyle={{ borderRadius: 8, border: '1px solid #efefef' }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#000000"
                  strokeWidth={2}
                  fill="url(#revGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">
              <p>Chưa có dữ liệu doanh thu</p>
            </div>
          )}
        </div>

        <div className="chart-card">
          <h3>Dịch vụ phổ biến</h3>
          {topServices.length > 0 ? (
            <div className="mt-8">
              {topServices.map((s, i) => (
                <div key={i} className="d-flex justify-content-between border-bottom-1" style={{ padding: '12px 0' }}>
                  <div>
                    <div className="fs-14 fw-600">{s.name}</div>
                    <div className="fs-12 text-muted">{s.count} lượt đặt</div>
                  </div>
                  <div className="fs-14 fw-600">
                    {formatFullPrice(s.revenue)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>Chưa có dữ liệu</p>
            </div>
          )}
        </div>
      </div>

      {/* Booking Status */}
      {/* {stats?.bookings_by_status && Object.keys(stats.bookings_by_status).length > 0 && (
        <div className="card mb-32">
          <div className="card-header">
            <h3 className="card-title">Trạng thái lịch hẹn</h3>
          </div>
          <div className="card-body d-flex gap-24">
            {Object.entries(stats.bookings_by_status).map(([status, count]) => (
              <div key={status} className="text-center">
                <span className={`badge badge-${status}`}>{status}</span>
                <div className="fs-24 fw-700 mt-8">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )} */}
    </div>
  );
}

export default Dashboard;
