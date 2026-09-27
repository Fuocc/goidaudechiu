export const API_BASE = import.meta.env.VITE_API_BASE;

// Token lấy trực tiếp từ Clerk ở mỗi request (Clerk tự cache & làm mới token ~60s).
// Không lưu token vào localStorage nữa: nếu trang bị chèn script độc (XSS) sẽ khó lấy cắp hơn.
let getAuthToken = async () => null;
export function setAuthTokenGetter(getter) {
  getAuthToken = typeof getter === 'function' ? getter : async () => null;
}

async function buildHeaders(extra, forceRefresh = false) {
  let token = null;
  try {
    token = await getAuthToken(forceRefresh ? { skipCache: true } : undefined);
  } catch (e) {
    token = null;
  }
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

export async function request(url, options = {}) {
  let res = await fetch(`${API_BASE}${url}`, { ...options, headers: await buildHeaders(options.headers) });

  // Token vừa hết hạn → lấy token mới và thử lại đúng 1 lần
  if (res.status === 401) {
    res = await fetch(`${API_BASE}${url}`, { ...options, headers: await buildHeaders(options.headers, true) });
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    const err = new Error(data?.error || 'Request failed');
    // Giữ lại mã HTTP + body để nơi gọi xử lý riêng (VD 409 trùng lịch), message không đổi
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.json();
}

// Ghép query string, bỏ qua giá trị rỗng; URLSearchParams tự encode (&, #, +, dấu cách...)
function withQuery(path, params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const query = new URLSearchParams(entries).toString();
  return query ? `${path}?${query}` : path;
}

// Branches
export const getBranches = () => request('/branches');
export const createBranch = (data) => request('/branches', { method: 'POST', body: JSON.stringify(data) });
export const updateBranch = (id, data) => request(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteBranch = (id) => request(`/branches/${id}`, { method: 'DELETE' });

// Services
export const getServices = () => request('/services/all');
export const createService = (data) => request('/services', { method: 'POST', body: JSON.stringify(data) });
export const updateService = (id, data) => request(`/services/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteService = (id) => request(`/services/${id}`, { method: 'DELETE' });

// Employees
export const getEmployees = (branchId) => request(withQuery('/employees', { branch_id: branchId }));
export const createEmployee = (data) => request('/employees', { method: 'POST', body: JSON.stringify(data) });
export const updateEmployee = (id, data) => request(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteEmployee = (id) => request(`/employees/${id}`, { method: 'DELETE' });

// Customers
export const getCustomers = (search) => request(withQuery('/customers', { search }));
// Phân trang ở server: trả { data, total, page, page_size, limited }
export const getCustomersPage = ({ page = 1, pageSize = 10, search } = {}) =>
  request(withQuery('/customers', { page, page_size: pageSize, search }));
export const createCustomer = (data) => request('/customers', { method: 'POST', body: JSON.stringify(data) });
export const updateCustomer = (id, data) => request(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCustomer = (id) => request(`/customers/${id}`, { method: 'DELETE' });

// Beds
export const getBeds = (branchId) => request(withQuery('/beds', { branch_id: branchId }));
export const createBed = (data) => request('/beds', { method: 'POST', body: JSON.stringify(data) });
export const updateBed = (id, data) => request(`/beds/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteBed = (id) => request(`/beds/${id}`, { method: 'DELETE' });

// Bookings
export const getBookings = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/bookings${query ? `?${query}` : ''}`);
};
export const getBookingsRange = (dateFrom, dateTo, branchId) => {
  const params = { date_from: dateFrom, date_to: dateTo };
  if (branchId) params.branch_id = branchId;
  const query = new URLSearchParams(params).toString();
  return request(`/bookings?${query}`);
};
export const createBooking = (data) => request('/bookings', { method: 'POST', body: JSON.stringify(data) });
export const updateBookingStatus = (id, status) => request(`/bookings/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
export const updateBooking = (id, data) => request(`/bookings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteBooking = (id) => request(`/bookings/${id}`, { method: 'DELETE' });

// Availability
export const getAvailability = (params) => {
  const query = new URLSearchParams(params).toString();
  return request(`/availability?${query}`);
};

// Employee Schedules
export const getEmployeeSchedules = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/employee-schedules${query ? `?${query}` : ''}`);
};
export const createEmployeeSchedule = (data) => request('/employee-schedules', { method: 'POST', body: JSON.stringify(data) });
export const createBulkSchedule = (data) => request('/employee-schedules/bulk', { method: 'POST', body: JSON.stringify(data) });
export const updateEmployeeSchedule = (id, data) => request(`/employee-schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteEmployeeSchedule = (id) => request(`/employee-schedules/${id}`, { method: 'DELETE' });

// Webhooks
export const getWebhooks = () => request('/webhooks');
export const createWebhook = (data) => request('/webhooks', { method: 'POST', body: JSON.stringify(data) });
export const updateWebhook = (id, data) => request(`/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteWebhook = (id) => request(`/webhooks/${id}`, { method: 'DELETE' });
export const testWebhook = (id) => request(`/webhooks/test/${id}`, { method: 'POST' });

// Dashboard
export const getDashboardStats = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/dashboard/stats${query ? `?${query}` : ''}`);
};
export const getRevenueChart = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/dashboard/revenue-chart${query ? `?${query}` : ''}`);
};
export const getTopServices = () => request('/dashboard/top-services');
 
 // Settings
 export const getSettings = () => request('/settings');
 export const updateSetting = (data) => request('/settings', { method: 'POST', body: JSON.stringify(data) });

// Notifications
export const getDashboardNotifications = () => request('/notifications/dashboard');
export const markNotificationRead = (id, read = true) => request(`/notifications/dashboard/${id}/read`, { method: 'PUT', body: JSON.stringify({ read }) });
export const markAllNotificationsRead = () => request('/notifications/dashboard/mark-all-read', { method: 'POST' });
export const deleteNotification = (id) => request(`/notifications/dashboard/${id}`, { method: 'DELETE' });

