const API_BASE = import.meta.env.VITE_API_BASE;

async function request(url, options = {}) {
  const token = localStorage.getItem('sb_access_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
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
export const getEmployees = (branchId) => request(`/employees${branchId ? `?branch_id=${branchId}` : ''}`);
export const createEmployee = (data) => request('/employees', { method: 'POST', body: JSON.stringify(data) });
export const updateEmployee = (id, data) => request(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteEmployee = (id) => request(`/employees/${id}`, { method: 'DELETE' });

// Customers
export const getCustomers = (search) => request(`/customers${search ? `?search=${search}` : ''}`);
export const createCustomer = (data) => request('/customers', { method: 'POST', body: JSON.stringify(data) });
export const updateCustomer = (id, data) => request(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCustomer = (id) => request(`/customers/${id}`, { method: 'DELETE' });

// Beds
export const getBeds = (branchId) => request(`/beds${branchId ? `?branch_id=${branchId}` : ''}`);
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
