/**
 * YOi Spa Booking - Frontend Application
 * Stateless URL-first navigation: URL is Single Source of Truth
 * Supports deep linking, F5 refresh, and browser back/forward.
 *
 * URL Params:
 *   step        - current wizard step (services | timing | branch | customerinfo | confirmation)
 *   service_id  - UUID of selected service (optional)
 *   date        - ISO date string e.g. 2026-05-15
 *   time        - start_time e.g. 10:00
 *   time_end    - end_time e.g. 11:00
 *   branch_id   - UUID of selected branch
 *   guests      - number of guests (default 1)
 */

const API_BASE = window.location.origin + '/api';
const DISABLE_AFTER_TIME = '20:15';
const SKIP_DURATION_MINUTES = 60;
const CUSTOMER_STORAGE_KEY = 'spa_booking_customer';

const STEPS = {
  SERVICES: 'services',
  TIME: 'timing',
  BRANCH: 'branch',
  CUSTOMERINFO: 'customerinfo',
  CONFIRMATION: 'confirmation'
};

const STEP_TITLES = {
  [STEPS.SERVICES]: 'Chọn dịch vụ',
  [STEPS.TIME]: 'Chọn Ngày & Giờ',
  [STEPS.BRANCH]: 'Chọn Chi Nhánh',
  [STEPS.CUSTOMERINFO]: 'Nhập thông tin',
  [STEPS.CONFIRMATION]: 'Đặt lịch thành công'
};

// ---- In-memory cache for API data (not booking selections) ----
const cache = {
  branches: [],      // Loaded once at init
  services: [],      // Loaded once at init
  availabilitySlots: [],  // Loaded per date change
  expandedServiceIds: new Set(),
};

// ---- DOM References ----
const $form = document.getElementById('booking-form');
const $btnBack = document.getElementById('btn-back');
const $wizardTitle = document.getElementById('wizard-title');
const $serviceCategories = document.getElementById('service-categories');
const $timeSlotsGrid = document.getElementById('time-slots-grid');
const $timeSlotsContainer = document.getElementById('time-slots-container');
const $branchList = document.getElementById('branch-list');
const $btnSkipService = document.getElementById('btn-skip-service');
const $calStrip = document.getElementById('cal-strip');
const $calMonthLabel = document.getElementById('cal-month-label');
const $calPrev = document.getElementById('cal-prev');
const $calNext = document.getElementById('cal-next');

// Calendar strip state (UI-only, not booking data)
const calState = {
  allDates: [],
  weekOffset: 0,
};

// ---- URL Param Helpers ----

/** Get all current booking params from URL */
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    step: p.get('step') || STEPS.SERVICES,
    service_id: p.get('service_id') || null,
    date: p.get('date') || null,
    time: p.get('time') || null,
    time_end: p.get('time_end') || null,
    branch_id: p.get('branch_id') || null,
    guests: parseInt(p.get('guests') || '1', 10),
  };
}

/** Push updated params to URL (merges with existing) */
function setParams(updates, replace = false) {
  const current = new URLSearchParams(window.location.search);
  Object.entries(updates).forEach(([k, v]) => {
    if (v === null || v === undefined) {
      current.delete(k);
    } else {
      current.set(k, String(v));
    }
  });
  const url = `${window.location.pathname}?${current.toString()}`;
  if (replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
}

/** Derived: get selected service object from cache */
function getSelectedService() {
  const { service_id } = getParams();
  if (!service_id) return null;
  return cache.services.find(s => s.id === service_id) || null;
}

/** Derived: get selected branch object from cache */
function getSelectedBranch() {
  const { branch_id } = getParams();
  if (!branch_id) return null;
  return cache.branches.find(b => b.id === branch_id) || null;
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await Promise.all([loadBranches(), loadServices()]);
  initCalendarStrip();
  bindEvents();
  loadCustomerFromStorage();
  // Full hydration from URL on every load
  await handleRouting();
}

// ---- Routing & Navigation ----

async function handleRouting() {
  const params = getParams();
  let { step } = params;

  // Validate step access based on URL params
  if (!canAccessStep(step, params)) {
    // Replace state so back button doesn't loop
    setParams({ step: STEPS.SERVICES }, true);
    step = STEPS.SERVICES;
  }

  // Hydrate date/time step: if step is TIME and date is set, load availability
  if (step === STEPS.TIME && params.date) {
    await hydrateTimeStep(params);
  }

  // Hydrate branch step: render branches with availability from selectedTime
  if (step === STEPS.BRANCH) {
    renderBranches(params);
  }

  renderUI(step, params);
}

/** Check if a step is accessible given the current URL params */
function canAccessStep(step, params) {
  if (step === STEPS.SERVICES) return true;
  if (step === STEPS.TIME) return true; // service is optional
  if (step === STEPS.BRANCH) return !!(params.date && params.time);
  if (step === STEPS.CUSTOMERINFO) return !!(params.date && params.time);
  if (step === STEPS.CONFIRMATION) return true; // post-submit, allow
  return false;
}

/** Navigate to a step, optionally updating other params */
function navigateTo(step, extraParams = {}) {
  setParams({ step, ...extraParams });
  handleRouting();
}

window.onpopstate = () => {
  handleRouting();
};

// ---- Data Loading ----

async function loadBranches() {
  try {
    const res = await fetch(`${API_BASE}/branches`);
    cache.branches = await res.json();
  } catch (err) {
    console.error('Error loading branches:', err);
  }
}

async function loadServices() {
  try {
    const res = await fetch(`${API_BASE}/services`);
    cache.services = await res.json();
  } catch (err) {
    console.error('Error loading services:', err);
  }
}

/** Load availability slots for a given date/service, store in cache */
async function loadAvailability(date, serviceId, guests) {
  const durationMinutes = serviceId ? null : SKIP_DURATION_MINUTES;
  const qs = new URLSearchParams({
    date,
    num_guests: String(guests),
    ...(serviceId ? { service_id: serviceId } : {}),
    ...(!serviceId ? { duration_minutes: String(durationMinutes) } : {})
  });

  $timeSlotsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: var(--color-text);">Đang tải khung giờ...</div>';
  $timeSlotsContainer.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/availability/merged?${qs.toString()}`);
    const data = await res.json();
    cache.availabilitySlots = data.slots || [];
  } catch (err) {
    console.error('Error loading availability:', err);
    cache.availabilitySlots = [];
    $timeSlotsGrid.innerHTML = 'Lỗi tải dữ liệu';
  }
}

/** Hydrate time step: load availability if needed, then render slots */
async function hydrateTimeStep(params) {
  const { date, service_id, guests, time } = params;
  await loadAvailability(date, service_id, guests);
  renderTimeSlots(params);
  // Restore calendar selection
  document.querySelectorAll('.cal-day').forEach(el => {
    const iso = el.dataset.iso;
    el.classList.toggle('selected', iso === date);
  });
  // Scroll calendar to the right week if date is in future
  if (date) {
    const dateObj = new Date(date + 'T00:00:00');
    const today = calState.allDates[0];
    const diffDays = Math.floor((dateObj - today) / 86400000);
    calState.weekOffset = Math.floor(diffDays / 7);
    renderCalendarStrip(date);
  }
}

// ---- Render Functions ----

function renderUI(step, params) {
  // Show/hide steps
  document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
  const activeEl = document.getElementById(`step-${step}`);
  if (activeEl) activeEl.classList.add('active');

  $wizardTitle.textContent = STEP_TITLES[step] || 'Đặt lịch';
  $btnBack.classList.toggle('hidden', step === STEPS.SERVICES || step === STEPS.CONFIRMATION);

  const isConfirmation = step === STEPS.CONFIRMATION;
  document.getElementById('step-header').classList.toggle('hidden', isConfirmation);
  document.getElementById('summary-sidebar').classList.toggle('hidden', isConfirmation);

  // Render step-specific content
  if (step === STEPS.SERVICES) {
    renderServices(params);
  }

  updateSummary(step, params);
}

function renderServices(params) {
  $serviceCategories.innerHTML = '';

  const categories = {};
  cache.services.forEach(s => {
    if (s.is_active === false) return;
    const cat = s.category || 'Dịch vụ Spa';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(s);
  });

  Object.entries(categories).forEach(([name, services]) => {
    const catHeader = document.createElement('h3');
    catHeader.className = 'category-title';
    catHeader.textContent = name;
    $serviceCategories.appendChild(catHeader);

    const list = document.createElement('div');
    list.className = 'service-list';

    services.forEach(s => {
      const isSelected = params.service_id === s.id;
      const isExpanded = cache.expandedServiceIds.has(s.id);

      const item = document.createElement('div');
      item.className = `service-item ${isSelected ? 'selected' : ''}`;
      item.innerHTML = `
        <div class="service-content">
          <h4>${s.name}</h4>
          <div class="tag-group">
            <span class="tag">${formatPriceShort(s.price)}</span>
            <span class="tag">${s.duration_minutes}p</span>
            <button type="button" class="tag btn-toggle-desc" style="cursor: pointer; border: none;">${isExpanded ? 'Rút gọn' : 'Xem thêm'}</button>
          </div>
          <div class="service-desc-container ${isExpanded ? 'expanded' : ''}">
             <p class="service-desc">${s.description || ''}</p>
          </div>
        </div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; margin-left: 16px;">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      `;

      item.onclick = (e) => {
        if (e.target.closest('.btn-toggle-desc')) return;
        // Navigate to TIME step, setting service_id in URL
        navigateTo(STEPS.TIME, { service_id: s.id });
      };

      const toggleBtn = item.querySelector('.btn-toggle-desc');
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (cache.expandedServiceIds.has(s.id)) {
          cache.expandedServiceIds.delete(s.id);
        } else {
          cache.expandedServiceIds.add(s.id);
        }
        renderServices(params);
      };

      list.appendChild(item);
    });

    $serviceCategories.appendChild(list);
  });
}

function renderBranches(params) {
  $branchList.innerHTML = '';
  const slot = cache.availabilitySlots.find(s => s.start_time === params.time);
  const availableBranchIds = slot?.branches || [];

  cache.branches.forEach((b, index) => {
    const isAvailable = availableBranchIds.includes(b.id);
    const item = document.createElement('button');
    item.className = `branch-item ${params.branch_id === b.id ? 'selected' : ''} ${!isAvailable ? 'disabled' : ''}`;
    item.type = 'button';
    item.disabled = !isAvailable;
    
    // Determine image: use b.image_url, or fallback to placeholder-branch1/2 based on index
    const placeholder = `./images/placeholder-branch${(index % 2) + 1}.jpg`;
    const imageUrl = b.image_url || placeholder;

    item.innerHTML = `
      <div class="branch-info-group">
        <img src="${imageUrl}" alt="${b.name}" class="sidebar-branch-img">
        <div class="branch-content">
          <h4>${b.name}</h4>
          <p class="branch-address">${b.address || ''}</p>
        </div>
      </div>
      <div class="branch-status">
        ${isAvailable 
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' 
          : '<span class="branch-tag-full">Hết chỗ</span>'}
      </div>
    `;

    if (isAvailable) {
      item.onclick = () => {
        navigateTo(STEPS.CUSTOMERINFO, { branch_id: b.id });
      };
    }
    $branchList.appendChild(item);
  });
}

function renderTimeSlots(params) {
  $timeSlotsGrid.innerHTML = '';
  const todaySelected = params.date === formatDateISO(new Date());
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const visibleSlots = cache.availabilitySlots.filter(slot => {
    const slotMinutes = timeToMinutesHHMM(slot.start_time);
    const isPast = todaySelected && slotMinutes < (nowMinutes + 15);
    const isTooLate = slot.start_time >= DISABLE_AFTER_TIME;
    return !(isPast || isTooLate);
  });

  if (visibleSlots.length === 0) {
    $timeSlotsGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:24px; opacity:0.5;">Hiện không có khung giờ nào trống cho ngày này!</div>';
    return;
  }

  visibleSlots.forEach(slot => {
    const available = slot.available;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `time-slot${!available ? ' unavailable' : ''}${params.time === slot.start_time ? ' selected' : ''}`;
    btn.disabled = !available;

    const [timePart, period] = formatTimeAmPm(slot.start_time);
    btn.innerHTML = `<span class="t-hour">${timePart}</span><span class="t-period">${period}</span>`;

    if (available) {
      btn.onclick = () => {
        const branchIds = slot.branches || [];
        const timeParams = {
          time: slot.start_time,
          time_end: slot.end_time || '',
        };

        navigateTo(STEPS.BRANCH, timeParams);
      };
    }

    $timeSlotsGrid.appendChild(btn);
  });
}

// ---- Event Binding ----

function bindEvents() {
  $btnBack.onclick = () => {
    const params = getParams();
    const { step } = params;
    if (step === STEPS.TIME) {
      navigateTo(STEPS.SERVICES);
    } else if (step === STEPS.BRANCH) {
      navigateTo(STEPS.TIME);
    } else if (step === STEPS.CUSTOMERINFO) {
      navigateTo(STEPS.BRANCH);
    }
  };

  $btnSkipService.onclick = () => {
    // Clear service selection and go to time step
    navigateTo(STEPS.TIME, { service_id: null });
  };

  $calPrev.onclick = () => {
    calState.weekOffset--;
    renderCalendarStrip(getParams().date);
  };

  $calNext.onclick = () => {
    calState.weekOffset++;
    renderCalendarStrip(getParams().date);
  };

  $form.onsubmit = handleSubmit;

  document.getElementById('sum-guests-select').onchange = (e) => {
    const guests = parseInt(e.target.value);
    const params = getParams();
    // Update guests in URL
    setParams({ guests }, true);
    // If on timing step with date, reload availability
    if (params.step === STEPS.TIME && params.date) {
      loadAvailability(params.date, params.service_id, guests).then(() => {
        renderTimeSlots({ ...params, guests });
      });
    }
  };

  document.getElementById('btn-edit-time').onclick = () => {
    navigateTo(STEPS.TIME);
  };

  document.getElementById('btn-new-booking').onclick = () => {
    // Clear all booking params, start fresh
    window.location.href = '/book?step=services';
  };
}

// ---- Calendar Strip ----

function initCalendarStrip() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  calState.allDates = [];
  for (let i = 0; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    calState.allDates.push(d);
  }
  calState.weekOffset = 0;
  renderCalendarStrip(null);
}

function renderCalendarStrip(selectedDate) {
  const totalWeeks = Math.ceil(calState.allDates.length / 7);
  const maxOffset = totalWeeks - 1;

  calState.weekOffset = Math.max(0, Math.min(calState.weekOffset, maxOffset));
  $calPrev.disabled = calState.weekOffset === 0;
  $calNext.disabled = calState.weekOffset >= maxOffset;

  const start = calState.weekOffset * 7;
  const week = calState.allDates.slice(start, start + 7);

  const firstDay = week[0];
  $calMonthLabel.textContent = `Tháng ${firstDay.getMonth() + 1}, ${firstDay.getFullYear()}`;

  $calStrip.innerHTML = '';
  const today = calState.allDates[0];
  const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  week.forEach(date => {
    const iso = formatDateISO(date);
    const isToday = iso === formatDateISO(today);
    const isSelected = iso === selectedDate;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cal-day${isSelected ? ' selected' : ''}`;
    btn.dataset.iso = iso;

    const label = isToday ? 'Nay' : DAY_LABELS[date.getDay()];
    btn.innerHTML = `
      <span class="cal-day-num">${date.getDate()}</span>
      <span class="cal-day-label">${label}</span>
    `;

    btn.onclick = async () => {
      const currentParams = getParams();
      // Update date in URL, clear time/branch since they're now stale
      setParams({ date: iso, time: null, time_end: null, branch_id: null }, true);
      // Reload availability for new date
      await loadAvailability(iso, currentParams.service_id, currentParams.guests);
      renderTimeSlots({ ...currentParams, date: iso, time: null });
      // Update visual selection
      document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
      btn.classList.add('selected');
      $timeSlotsContainer.classList.remove('hidden');
    };

    $calStrip.appendChild(btn);
  });
}

// ---- Summary Sidebar ----

function updateSummary(step, params) {
  const service = getSelectedService();
  const branch = getSelectedBranch();

  const sumServiceSection = document.getElementById('sum-service-section');
  const sumTimeSection = document.getElementById('sum-time-section');
  const sumGuestsSection = document.getElementById('sum-guests-section');
  const branchInfo = document.getElementById('sidebar-branch-info');
  const guestSelect = document.getElementById('sum-guests-select');

  // Sync guest count
  if (guestSelect) {
    guestSelect.value = params.guests;
    // Only allow editing guests in initial steps
    guestSelect.disabled = (step === STEPS.BRANCH || step === STEPS.CUSTOMERINFO);
  }

  const showService = step !== STEPS.SERVICES;
  const showTime = !!(params.date && params.time && step !== STEPS.SERVICES && step !== STEPS.TIME);
  const showBranch = !!(branch && (step === STEPS.BRANCH || step === STEPS.CUSTOMERINFO));

  sumServiceSection.classList.toggle('hidden', !showService);
  sumTimeSection.classList.toggle('hidden', !showTime);
  branchInfo.classList.toggle('hidden', !showBranch);
  $btnSkipService.classList.toggle('hidden', step !== STEPS.SERVICES);

  // Service info
  if (showService) {
    document.getElementById('sum-service-name').textContent = service ? service.name : 'Chọn sau ở spa';
    document.getElementById('sum-service-duration').textContent = service ? `${service.duration_minutes}p` : `${SKIP_DURATION_MINUTES}p`;
    document.getElementById('sum-service-price').textContent = service ? formatPrice(service.price) : formatPrice(0);
  }

  // Time info
  if (showTime) {
    document.getElementById('sum-time-range').textContent = `${params.time} - ${params.time_end || ''}`;
    document.getElementById('sum-time-date').textContent = formatDateDisplayFull(new Date(params.date + 'T00:00:00'));
  }

  // Branch info
  if (showBranch) {
    document.getElementById('sum-branch-name').textContent = branch.name;
    document.getElementById('sum-branch-address').textContent = branch.address;
    
    // Update branch image in sidebar
    const branchImg = document.getElementById('sum-branch-img');
    if (branchImg && branch) {
      // Find branch index to use the same placeholder logic as in renderBranches
      const index = cache.branches.findIndex(b => b.id === branch.id);
      const placeholder = `./images/placeholder-branch${(index === -1 ? 0 : index % 2) + 1}.jpg`;
      branchImg.src = branch.image_url || placeholder;
    }
  }
}

// ---- Confirmation Page ----

function populateConfirmation(params, customerData) {
  const service = getSelectedService();
  const branch = getSelectedBranch();

  document.getElementById('conf-date-time').textContent = formatDateDisplayFull(new Date(params.date + 'T00:00:00'));
  document.getElementById('conf-time-range').textContent = `${params.time} — ${params.time_end || ''}`;

  document.getElementById('conf-service-name').textContent = service?.name || 'Chọn sau ở spa';
  document.getElementById('conf-service-price').textContent = service
    ? `${formatPrice(service.price)} — ${service.duration_minutes} phút`
    : `0đ — ${SKIP_DURATION_MINUTES} phút`;

  document.getElementById('conf-customer-name').textContent = customerData.name;
  document.getElementById('conf-customer-phone').textContent = `${customerData.phone} — ${params.guests} Người`;

  const notesRow = document.getElementById('conf-notes-row');
  if (customerData.notes) {
    notesRow.classList.remove('hidden');
    document.getElementById('conf-notes').textContent = customerData.notes;
  } else {
    notesRow.classList.add('hidden');
  }

  if (branch) {
    document.getElementById('conf-branch-name').textContent = branch.address || branch.name;
    const mapLink = document.querySelector('.conf-direction');
    if (mapLink) {
      mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address || branch.name)}`;
    }
  }
}

// ---- Submission ----

async function handleSubmit(e) {
  e.preventDefault();
  const $btn = document.getElementById('btn-submit');
  if ($btn.disabled) return;
  $btn.disabled = true;
  $btn.textContent = 'Đang xử lý...';

  const params = getParams();
  const branch = getSelectedBranch();

  const customerData = {
    name: document.getElementById('customer-name').value.trim(),
    phone: document.getElementById('customer-phone').value.trim(),
    email: document.getElementById('customer-email').value.trim() || null,
    notes: document.getElementById('notes').value.trim() || null,
  };

  const payload = {
    branch_id: branch?.id || params.branch_id,
    service_id: params.service_id || null,
    num_guests: params.guests,
    customer_name: customerData.name,
    customer_phone: customerData.phone,
    customer_email: customerData.email,
    booking_date: params.date,
    start_time: params.time,
    notes: customerData.notes,
  };

  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Booking failed');
    }

    saveCustomerToStorage(customerData);
    populateConfirmation(params, customerData);
    navigateTo(STEPS.CONFIRMATION);
  } catch (err) {
    alert('Đặt lịch thất bại: ' + err.message);
  } finally {
    $btn.disabled = false;
    $btn.textContent = 'Đặt Lịch';
  }
}

// ---- Helpers ----

function formatPrice(price) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
}

function formatPriceShort(price) {
  if (price === 0) return 'Free';
  return (price / 1000) + 'k';
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateDisplayFull(date) {
  const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  return `${days[date.getDay()]}, ${date.getDate()} tháng ${months[date.getMonth()]}, ${date.getFullYear()}`;
}

function formatTimeAmPm(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return [`${h12}:${String(m).padStart(2, '0')}`, period];
}

function timeToMinutesHHMM(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function saveCustomerToStorage(customerData) {
  localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify({
    name: customerData.name,
    phone: customerData.phone,
    email: customerData.email || '',
  }));
}

function loadCustomerFromStorage() {
  try {
    const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data?.name) document.getElementById('customer-name').value = data.name;
    if (data?.phone) document.getElementById('customer-phone').value = data.phone;
    if (data?.email) document.getElementById('customer-email').value = data.email;
  } catch (_) { }
}