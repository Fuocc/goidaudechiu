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
const SPA_CLOSE_HOUR = 22; // 22:00 PM (10:00 PM) closing hour of the spa
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

// Advanced Client Cache with TTL (Time-To-Live) and max size protection
const availabilityCache = {
  store: new Map(),
  TTL_MS: 3 * 60 * 1000, // 3 minutes cache lifetime (keeps timeslots fresh)
  
  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.TTL_MS) {
      this.store.delete(key);
      return null;
    }
    return item.data;
  },
  
  set(key, data) {
    // Evict oldest item if cache exceeds 15 entries (LRU style)
    if (this.store.size >= 15) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, {
      data,
      timestamp: Date.now()
    });
  },
  
  has(key) {
    return this.get(key) !== null;
  }
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
const $btnSkipWrap = document.getElementById('btn-skip-wrap');
const $calStrip = document.getElementById('cal-strip');
const $calMonthLabel = document.getElementById('cal-month-label');
const $calPrev = document.getElementById('cal-prev');
const $calNext = document.getElementById('cal-next');

// Calendar strip state (UI-only, not booking data)
const calState = {
  allDates: [],
  weekOffset: 0,
};

let calSwiper = null;

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
  checkBookingBlock();
  // Full hydration from URL on every load
  await handleRouting();

  // Re-render calendar strip on window resize for responsive layout changes
  window.addEventListener('resize', () => {
    const params = getParams();
    if (params.step === STEPS.TIME) {
      renderCalendarStrip(params.date);
    }
  });

  // ---- JS Prefetch System ----
  // Prefetch resources when browser is idle for faster subsequent navigations
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      prefetchResources();
    }, { timeout: 2000 });
  } else {
    setTimeout(prefetchResources, 1500);
  }
}

/** Prefetch API data and assets during idle time for faster navigation */
function prefetchResources() {
  // Prefetch today's availability if not already loaded
  const todayISO = formatDateISO(new Date());
  const params = getParams();

  // Prefetch availability for today
  if (cache.availabilitySlots.length === 0) {
    const guests = params.guests || 1;
    // Use fetch directly to not affect the UI
    const qs = new URLSearchParams({
      date: todayISO,
      num_guests: String(guests),
      duration_minutes: String(SKIP_DURATION_MINUTES)
    });
    fetch(`${API_BASE}/availability/merged?${qs.toString()}`).catch(() => { });
  }

  // Prefetch tomorrow's availability too
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = formatDateISO(tomorrow);
  const qsTomorrow = new URLSearchParams({
    date: tomorrowISO,
    num_guests: String(params.guests || 1),
    duration_minutes: String(SKIP_DURATION_MINUTES)
  });
  fetch(`${API_BASE}/availability/merged?${qsTomorrow.toString()}`).catch(() => { });

  // Prefetch Google Fonts (if not already loaded via stylesheet)
  const fontsLink = document.createElement('link');
  fontsLink.rel = 'prefetch';
  fontsLink.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Lato:wght@300;400;700&display=swap';
  document.head.appendChild(fontsLink);

  // Prefetch branch images
  cache.branches.forEach((b, index) => {
    if (b.image_url) {
      const img = new Image();
      img.src = b.image_url;
    }
    // Also prefetch placeholder images
    const placeholder = `./images/placeholder-branch${(index % 2) + 1}.jpg`;
    const pImg = new Image();
    pImg.src = placeholder;
  });
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

  // Auto-select today if on TIME step and no date is set in URL params,
  // or auto-advance to tomorrow if the current time is past 8:00 PM (20:00).
  if (step === STEPS.TIME) {
    const now = new Date();
    const todayISO = formatDateISO(now);
    const isPastEightPM = now.getHours() >= 20; // past 8:00 PM (20:00)

    if (isPastEightPM) {
      if (!params.date || params.date === todayISO) {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const tomorrowISO = formatDateISO(tomorrow);
        setParams({ date: tomorrowISO }, true);
        params.date = tomorrowISO;
      }
    } else {
      if (!params.date) {
        setParams({ date: todayISO }, true);
        params.date = todayISO;
      }
    }
  }

  // Hydrate date/time step: if step is TIME and date is set, load availability
  if (step === STEPS.TIME && params.date) {
    hydrateTimeStep(params);
  }

  // Hydrate branch step: render branches with availability from selectedTime
  if (step === STEPS.BRANCH) {
    renderBranches(params);
  }

  // Hydrate confirmation step
  if (step === STEPS.CONFIRMATION) {
    const customerData = getSavedCustomerData();
    populateConfirmation(params, customerData);
  }

  // Hydrate customerinfo step: handle slot holding and countdown
  if (step === STEPS.CUSTOMERINFO) {
    handleHoldState(params);
  } else {
    // If they navigate away from customerinfo to services/timing/branch,
    // release the hold immediately
    if (step !== STEPS.CONFIRMATION) {
      releaseHoldIfNavigatedAway(step);
    }
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
    const branches = await res.json();
    cache.branches = branches.map(b => {
      let mappedName = b.name;
      if (b.name && (b.name.includes("CN1") || b.name.includes("CN 1"))) {
        mappedName = "Ý Ơi Spa - CN 1";
      } else if (b.name && (b.name.includes("CN2") || b.name.includes("CN 2"))) {
        mappedName = "Ý Ơi Spa - CN 2";
      }
      return {
        ...b,
        name: mappedName
      };
    });
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

// Background prefetching for next 2 days to make the experience ultra-premium
function prefetchNextDays(currentDateStr, serviceId, guests) {
  const currentDate = new Date(currentDateStr + 'T00:00:00');
  
  for (let i = 1; i <= 2; i++) {
    const nextDateObj = new Date(currentDate);
    nextDateObj.setDate(currentDate.getDate() + i);
    
    // Format date to YYYY-MM-DD
    const yyyy = nextDateObj.getFullYear();
    const mm = String(nextDateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(nextDateObj.getDate()).padStart(2, '0');
    const nextDateStr = `${yyyy}-${mm}-${dd}`;
    
    const durationMinutes = serviceId ? null : SKIP_DURATION_MINUTES;
    const qs = new URLSearchParams({
      date: nextDateStr,
      num_guests: String(guests),
      ...(serviceId ? { service_id: serviceId } : {}),
      ...(!serviceId ? { duration_minutes: String(durationMinutes) } : {})
    });
    
    const cacheKey = qs.toString();
    
    // Fetch only if it's not already in the cache
    if (!availabilityCache.has(cacheKey)) {
      fetch(`${API_BASE}/availability/merged?${qs.toString()}`)
        .then(res => res.json())
        .then(data => {
          const slots = data.slots || [];
          availabilityCache.set(cacheKey, slots);
          console.log(`⚡ [Cache Prefetch] Cached next availability for: ${nextDateStr}`);
        })
        .catch(err => {
          console.warn(`[Cache Prefetch] Failed for: ${nextDateStr}`, err);
        });
    }
  }
}

/** Load availability slots for a given date/service, store in cache and prefetch next days */
async function loadAvailability(date, serviceId, guests) {
  const durationMinutes = serviceId ? null : SKIP_DURATION_MINUTES;
  const qs = new URLSearchParams({
    date,
    num_guests: String(guests),
    ...(serviceId ? { service_id: serviceId } : {}),
    ...(!serviceId ? { duration_minutes: String(durationMinutes) } : {})
  });

  const cacheKey = qs.toString();

  // If in cache, resolve instantly and prefetch the next 2 days in the background
  if (availabilityCache.has(cacheKey)) {
    cache.availabilitySlots = availabilityCache.get(cacheKey);
    prefetchNextDays(date, serviceId, guests);
    return;
  }

  // Show Skeleton Loaders while fetching
  $timeSlotsGrid.innerHTML = Array(15).fill(0).map(() => '<div class="skeleton-slot"></div>').join('');
  $timeSlotsContainer.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/availability/merged?${qs.toString()}`);
    const data = await res.json();
    const slots = data.slots || [];
    cache.availabilitySlots = slots;
    availabilityCache.set(cacheKey, slots);
    
    // Fetch next 2 days in background to accelerate transitions
    prefetchNextDays(date, serviceId, guests);
  } catch (err) {
    console.error('Error loading availability:', err);
    cache.availabilitySlots = [];
    $timeSlotsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: red;">Lỗi tải khung giờ. Vui lòng thử lại.</div>';
  }
}

/** Hydrate time step: load availability if needed, then render slots */
async function hydrateTimeStep(params) {
  const { date, service_id, guests, time } = params;

  // Restore calendar selection synchronously first to prevent visual lag
  document.querySelectorAll('.cal-day').forEach(el => {
    const iso = el.dataset.iso;
    el.classList.toggle('selected', iso === date);
  });
  if (date) {
    const dateObj = new Date(date + 'T00:00:00');
    const today = calState.allDates[0];
    const diffDays = Math.floor((dateObj - today) / 86400000);
    calState.weekOffset = Math.floor(diffDays / 7);
    renderCalendarStrip(date);
  }

  // Load availability (shows skeletons if not cached, otherwise resolves instantly)
  await loadAvailability(date, service_id, guests);
  renderTimeSlots(params);
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

  const bookingWrap = document.querySelector('.booking-wrap');
  if (bookingWrap) {
    bookingWrap.className = `booking-wrap step-${step}`;
  }

  const $headerGuests = document.getElementById('header-guests-select');
  if ($headerGuests) {
    $headerGuests.classList.toggle('hidden', step !== STEPS.SERVICES);
    $headerGuests.value = params.guests;
  }

  // Render step-specific content
  if (step === STEPS.SERVICES) {
    renderServices(params);
  }

  updateSummary(step, params);

  // Apply submission block styling if client is rate-limited
  if (step === STEPS.CUSTOMERINFO) {
    checkBookingBlock();
  }
}

function renderServices(params) {
  $serviceCategories.innerHTML = '';

  // Define the desired category order
  const CATEGORY_ORDER = ['Gội Đầu', 'Massage', 'Combo', '4 Tay'];
  const HIDDEN_CATEGORIES = ['Khác'];

  const categories = {};
  cache.services.forEach(s => {
    if (s.is_active === false) return;
    const cat = s.category || 'Dịch vụ Spa';
    if (HIDDEN_CATEGORIES.includes(cat)) return;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(s);
  });

  // Sort by defined order, then alphabetically for any uncategorized ones
  const sortedCategories = Object.keys(categories).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Render horizontal tabs at the top of the categories container
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'category-tabs';
  sortedCategories.forEach((name, index) => {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = `tab-btn${index === 0 ? ' active' : ''}`;
    tabBtn.textContent = name;
    tabBtn.onclick = () => {
      tabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      tabBtn.classList.add('active');

      // Scroll to target heading
      const headers = Array.from($serviceCategories.querySelectorAll('.category-title'));
      const target = headers.find(h => h.textContent === name);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    tabsContainer.appendChild(tabBtn);
  });
  $serviceCategories.appendChild(tabsContainer);

  sortedCategories.forEach(name => {
    const services = categories[name];
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
        ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#386665" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
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

  // Selected date object to check day of week
  const dateObj = new Date(params.date + 'T00:00:00');
  const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

  const visibleSlots = cache.availabilitySlots.filter(slot => {
    const slotMinutes = timeToMinutesHHMM(slot.start_time);
    const isPast = todaySelected && slotMinutes < (nowMinutes + 15);
    const isTooLate = slot.start_time >= DISABLE_AFTER_TIME;
    if (isPast || isTooLate) return false;

    // Requirement: Hide timeslots from 09:00 to 09:45 inclusive on weekdays (Mon-Fri)
    // Saturday and Sunday show slots starting from 09:00 normally
    if (!isWeekend) {
      if (slot.start_time >= '09:00' && slot.start_time <= '09:45') {
        return false;
      }
    }

    return true;
  });

  if (visibleSlots.length === 0) {
    $timeSlotsGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:24px; font-family:var(--font-heading);">Ý không tìm được lịch trống cho ngày này rồi. Mình thử chọn ngày khác hoặc liên hệ cho Ý qua <a href="https://m.me/61573340536773?text=Hi,%20%C3%9D%20cho%20m%C3%ACnh%20%C4%91%E1%BA%B7t%20l%E1%BB%8Bch%207h%20t%E1%BB%91i%20nay%20%E1%BB%9F%20CN%201%20ho%E1%BA%B7c%202%20nh%C3%A9." style="color: inherit; text-decoration:underline; text-underline-offset:3px;" target="_blank" rel="noopener noreferrer">Fanpage</a> hoặc <a href="https://zalo.me/0968241808" style="color: inherit; text-decoration:underline; text-underline-offset:3px;" target="_blank" rel="noopener noreferrer">Zalo</a> để Ý hỗ trợ mình đặt lịch nghen ^^.</div>';
    return;
  }

  visibleSlots.forEach((slot, index) => {
    const available = slot.available;
    const isWeekdayEarly = slot.weekday_early === true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `time-slot${!available ? ' unavailable' : ''}${isWeekdayEarly ? ' weekday-early' : ''}${params.time === slot.start_time ? ' selected' : ''}`;
    btn.disabled = !available || isWeekdayEarly;

    // Stagger fade-in animation: cascading delay per time slot item
    btn.style.animationDelay = `${index * 30}ms`;

    if (isWeekdayEarly) {
      btn.style.opacity = '0.3';
      btn.style.pointerEvents = 'none';
    }

    const [timePart, period] = formatTime12h(slot.start_time);
    btn.innerHTML = `<span class="t-hour">${timePart}</span><span class="t-period">${period}</span>`;

    if (available && !isWeekdayEarly) {
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
    if (window.innerWidth <= 1024) {
      const params = getParams();
      const selectedDateStr = params.date || formatDateISO(new Date());
      const currentIndex = calState.allDates.findIndex(d => formatDateISO(d) === selectedDateStr);
      const newIndex = currentIndex - 1;
      if (newIndex >= 0) {
        const targetIso = formatDateISO(calState.allDates[newIndex]);
        setParams({ date: targetIso, time: null, time_end: null, branch_id: null }, true);
        renderCalendarStrip(targetIso, true);
        loadAvailability(targetIso, params.service_id, params.guests).then(() => {
          renderTimeSlots({ ...params, date: targetIso, time: null });
        });
      }
    } else {
      calState.weekOffset--;
      renderCalendarStrip(getParams().date, true);
    }
  };

  $calNext.onclick = () => {
    if (window.innerWidth <= 1024) {
      const params = getParams();
      const selectedDateStr = params.date || formatDateISO(new Date());
      const currentIndex = calState.allDates.findIndex(d => formatDateISO(d) === selectedDateStr);
      const newIndex = currentIndex + 1;
      if (newIndex < calState.allDates.length) {
        const targetIso = formatDateISO(calState.allDates[newIndex]);
        setParams({ date: targetIso, time: null, time_end: null, branch_id: null }, true);
        renderCalendarStrip(targetIso, true);
        loadAvailability(targetIso, params.service_id, params.guests).then(() => {
          renderTimeSlots({ ...params, date: targetIso, time: null });
        });
      }
    } else {
      calState.weekOffset++;
      renderCalendarStrip(getParams().date, true);
    }
  };

  $form.onsubmit = handleSubmit;

  document.getElementById('sum-guests-select').onchange = (e) => {
    const guests = parseInt(e.target.value);
    const params = getParams();
    // Sync header guest select
    const $headerGuests = document.getElementById('header-guests-select');
    if ($headerGuests) $headerGuests.value = guests;
    // Update guests in URL
    setParams({ guests }, true);
    // Update pill text
    const guestsPill = document.getElementById('summary-guests-pill');
    if (guestsPill) guestsPill.textContent = `${guests} Khách`;
    // If on timing step with date, reload availability
    if (params.step === STEPS.TIME && params.date) {
      loadAvailability(params.date, params.service_id, guests).then(() => {
        renderTimeSlots({ ...params, guests });
      });
    }
  };

  // Header guest selector (mobile, services step)
  const $headerGuests = document.getElementById('header-guests-select');
  if ($headerGuests) {
    $headerGuests.onchange = (e) => {
      const guests = parseInt(e.target.value);
      // Sync sidebar guest select
      document.getElementById('sum-guests-select').value = guests;
      // Update guests in URL
      setParams({ guests }, true);
      // Update pill text
      const guestsPill = document.getElementById('summary-guests-pill');
      if (guestsPill) guestsPill.textContent = `${guests} Khách`;
    };
  }

  document.getElementById('btn-edit-time').onclick = () => {
    navigateTo(STEPS.TIME);
  };

  document.getElementById('btn-new-booking').onclick = () => {
    // Clear all booking params, start fresh
    window.location.href = '/book?step=services';
  };

  // Mobile drawer interaction — Google Maps-style pure translateY bottom sheet
  const $sidebar = document.getElementById('summary-sidebar');
  const $overlay = document.getElementById('drawer-overlay');

  if ($sidebar && $overlay) {
    let touchStartY = 0;
    let touchStartX = 0;
    let startTranslateY = 0;
    let currentTranslateY = 0;
    let maxTranslateY = 0;
    let isDragging = false;
    let startTime = 0;
    let hasDragged = false;

    // Calculate how far down we need to push the sheet to show only the peek area
    function calcMaxTranslate() {
      // Temporarily show hidden content to measure full expanded height
      const hiddenEls = $sidebar.querySelectorAll('.summary-info, #sidebar-branch-info, .sidebar-footer-text');
      const wasHidden = [];
      hiddenEls.forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none') {
          wasHidden.push(el);
          el.style.display = '';
          el.style.visibility = 'hidden';
          el.style.position = 'absolute';
        }
      });

      const totalH = $sidebar.scrollHeight;

      // Restore hidden state
      wasHidden.forEach(el => {
        el.style.display = '';
        el.style.visibility = '';
        el.style.position = '';
      });

      const params = getParams();
      const peekH = (params.step === STEPS.CUSTOMERINFO) ? 156 : 90;
      return Math.max(0, totalH - peekH);
    }

    function canSwipe() {
      const params = getParams();
      return params.step !== STEPS.SERVICES && params.step !== STEPS.CONFIRMATION && window.innerWidth <= 1024;
    }

    $sidebar.addEventListener('touchstart', (e) => {
      if (!canSwipe()) return;
      if (e.target.closest('button, select, svg, a, .btn-edit-summary')) return;

      const touch = e.touches[0];
      touchStartY = touch.clientY;
      touchStartX = touch.clientX;
      startTime = Date.now();
      hasDragged = false;
      isDragging = true;

      // Measure starting position based on stable scrollHeight
      const isExpanded = $sidebar.classList.contains('expanded');
      maxTranslateY = calcMaxTranslate();
      startTranslateY = isExpanded ? 0 : maxTranslateY;
      currentTranslateY = startTranslateY;

      // Position the sheet at the correct starting point
      $sidebar.style.transition = 'none';
      $overlay.style.transition = 'none';
      $sidebar.style.transform = `translateY(${currentTranslateY}px)`;
    }, { passive: true });

    $sidebar.addEventListener('touchmove', (e) => {
      if (!isDragging) return;

      const touch = e.touches[0];
      const diffY = touch.clientY - touchStartY;
      const diffX = touch.clientX - touchStartX;

      if (!hasDragged && Math.abs(diffY) > 8 && Math.abs(diffY) > Math.abs(diffX)) {
        hasDragged = true;
      }

      if (hasDragged) {
        if (e.cancelable) e.preventDefault();

        let targetY = startTranslateY + diffY;

        // Rubber-band past boundaries
        if (targetY < 0) {
          targetY = targetY * 0.25;
        } else if (targetY > maxTranslateY) {
          targetY = maxTranslateY + (targetY - maxTranslateY) * 0.25;
        }

        currentTranslateY = targetY;
        $sidebar.style.transform = `translateY(${currentTranslateY}px)`;

        // Sync overlay opacity
        const openPct = Math.max(0, Math.min(1, 1 - currentTranslateY / maxTranslateY));
        $overlay.style.opacity = openPct;
        $overlay.style.pointerEvents = openPct > 0.05 ? 'auto' : 'none';

        // Cross-fade the peek and bottom submit buttons
        const params = getParams();
        if (params.step === STEPS.CUSTOMERINFO) {
          const peekBtn = document.getElementById('btn-drawer-submit-peek');
          const skipContainer = document.getElementById('skip-btn-container');
          if (peekBtn) {
            peekBtn.style.opacity = 1 - openPct;
            peekBtn.style.pointerEvents = openPct > 0.5 ? 'none' : 'auto';
          }
          if (skipContainer) {
            skipContainer.style.opacity = openPct;
            skipContainer.style.pointerEvents = openPct > 0.5 ? 'auto' : 'none';
          }
        }
      }
    }, { passive: false });

    $sidebar.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;

      if (!hasDragged) {
        // No drag: restore to the state before touchstart
        $sidebar.style.transition = '';
        $sidebar.style.transform = '';
        $overlay.style.transition = '';
        $overlay.style.opacity = '';
        $overlay.style.pointerEvents = '';
        return;
      }

      const diffY = e.changedTouches[0].clientY - touchStartY;
      const elapsed = Date.now() - startTime;
      const velocity = diffY / elapsed; // px/ms

      // Animate to final position
      $sidebar.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      $overlay.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';

      // Flick detection or position-based snap
      let shouldExpand;
      if (Math.abs(velocity) > 0.25) {
        shouldExpand = velocity < 0; // swipe up = expand
      } else {
        shouldExpand = currentTranslateY < maxTranslateY * 0.5;
      }

      const params = getParams();

      if (shouldExpand) {
        $sidebar.style.transform = 'translateY(0px)';
        $overlay.style.opacity = '1';
        $overlay.style.pointerEvents = 'auto';

        if (params.step === STEPS.CUSTOMERINFO) {
          const peekBtn = document.getElementById('btn-drawer-submit-peek');
          const skipContainer = document.getElementById('skip-btn-container');
          if (peekBtn) {
            peekBtn.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            peekBtn.style.opacity = '0';
          }
          if (skipContainer) {
            skipContainer.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            skipContainer.style.opacity = '1';
          }
        }

        $sidebar.classList.add('expanded');
        $overlay.classList.add('active');
        document.body.classList.add('no-scroll');
      } else {
        $sidebar.style.transform = `translateY(${maxTranslateY}px)`;
        $overlay.style.opacity = '0';
        $overlay.style.pointerEvents = 'none';

        if (params.step === STEPS.CUSTOMERINFO) {
          const peekBtn = document.getElementById('btn-drawer-submit-peek');
          const skipContainer = document.getElementById('skip-btn-container');
          if (peekBtn) {
            peekBtn.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            peekBtn.style.opacity = '1';
          }
          if (skipContainer) {
            skipContainer.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            skipContainer.style.opacity = '0';
          }
        }

        $sidebar.classList.remove('expanded');
        $overlay.classList.remove('active');
        document.body.classList.remove('no-scroll');
      }

      // Clean up inline styles after transition completes
      const cleanup = (ev) => {
        if (ev.propertyName === 'transform') {
          $sidebar.style.transition = '';
          $sidebar.style.transform = '';
          $overlay.style.transition = '';
          $overlay.style.opacity = '';
          $overlay.style.pointerEvents = '';

          if (params.step === STEPS.CUSTOMERINFO) {
            const peekBtn = document.getElementById('btn-drawer-submit-peek');
            const skipContainer = document.getElementById('skip-btn-container');
            if (peekBtn) {
              peekBtn.style.transition = '';
              peekBtn.style.opacity = '';
              peekBtn.style.pointerEvents = '';
            }
            if (skipContainer) {
              skipContainer.style.transition = '';
              skipContainer.style.opacity = '';
              skipContainer.style.pointerEvents = '';
            }
          }

          $sidebar.removeEventListener('transitionend', cleanup);
        }
      };
      $sidebar.addEventListener('transitionend', cleanup);
    }, { passive: true });

    // Collapse drawer helper
    function collapseDrawer() {
      const params = getParams();
      const totalH = $sidebar.scrollHeight;
      const peekH = (params.step === STEPS.CUSTOMERINFO) ? 156 : 90;
      const snapTranslateY = Math.max(0, totalH - peekH);

      $sidebar.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      $overlay.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      $sidebar.style.transform = `translateY(${snapTranslateY}px)`;
      $overlay.style.opacity = '0';
      $overlay.style.pointerEvents = 'none';

      if (params.step === STEPS.CUSTOMERINFO) {
        const peekBtn = document.getElementById('btn-drawer-submit-peek');
        const skipContainer = document.getElementById('skip-btn-container');
        if (peekBtn) {
          peekBtn.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
          peekBtn.style.opacity = '1';
        }
        if (skipContainer) {
          skipContainer.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
          skipContainer.style.opacity = '0';
        }
      }

      // Remove classes immediately for instant layout sync
      $sidebar.classList.remove('expanded');
      $overlay.classList.remove('active');
      document.body.classList.remove('no-scroll');

      const cleanup = (ev) => {
        if (ev.propertyName === 'transform') {
          $sidebar.style.transition = '';
          $sidebar.style.transform = '';
          $overlay.style.transition = '';
          $overlay.style.opacity = '';
          $overlay.style.pointerEvents = '';

          if (params.step === STEPS.CUSTOMERINFO) {
            const peekBtn = document.getElementById('btn-drawer-submit-peek');
            const skipContainer = document.getElementById('skip-btn-container');
            if (peekBtn) {
              peekBtn.style.transition = '';
              peekBtn.style.opacity = '';
              peekBtn.style.pointerEvents = '';
            }
            if (skipContainer) {
              skipContainer.style.transition = '';
              skipContainer.style.opacity = '';
              skipContainer.style.pointerEvents = '';
            }
          }

          $sidebar.removeEventListener('transitionend', cleanup);
        }
      };
      $sidebar.addEventListener('transitionend', cleanup);
    }

    // Tap overlay to collapse
    $overlay.onclick = collapseDrawer;

    // Swipe down overlay to collapse
    let overlayTouchStartY = 0;
    let overlayHasDragged = false;

    $overlay.addEventListener('touchstart', (e) => {
      overlayTouchStartY = e.touches[0].clientY;
      overlayHasDragged = false;
    }, { passive: true });

    $overlay.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const currentY = e.touches[0].clientY;
        const diffY = currentY - overlayTouchStartY;
        if (diffY > 30) { // Swiped down more than 30px
          overlayHasDragged = true;
        }
      }
    }, { passive: true });

    $overlay.addEventListener('touchend', () => {
      if (overlayHasDragged) {
        collapseDrawer();
      }
    }, { passive: true });
  }
}

// ---- Calendar Strip ----

function initCalendarStrip() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Dynamically calculate the end of next month
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed
  const endOfNextMonth = new Date(currentYear, currentMonth + 2, 0);

  calState.allDates = [];
  const currentDate = new Date(today);
  while (currentDate <= endOfNextMonth) {
    calState.allDates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  calState.weekOffset = 0;

  const params = getParams();
  renderCalendarStrip(params.date);

  // ---- Enhanced Drag-to-scroll with Momentum (Mouse + Touch) ----
  let isDown = false;
  let startX;
  let scrollLeft;
  let lastX;
  let lastTime;
  let velocity = 0;
  let momentumId = null;
  let hasDragged = false; // Track if actual drag occurred (vs. click)
  const DRAG_THRESHOLD = 5; // px threshold to distinguish drag from click
  let dragStartX;

  function startDrag(pageX) {
    if (window.innerWidth <= 1024) return;
    isDown = true;
    hasDragged = false;
    dragStartX = pageX;
    startX = pageX - $calStrip.offsetLeft;
    scrollLeft = $calStrip.scrollLeft;
    lastX = pageX;
    lastTime = Date.now();
    velocity = 0;
    if (momentumId) {
      cancelAnimationFrame(momentumId);
      momentumId = null;
    }
  }

  function moveDrag(pageX) {
    if (window.innerWidth <= 1024) return;
    if (!isDown) return;

    // Check if we've exceeded drag threshold
    if (!hasDragged && Math.abs(pageX - dragStartX) > DRAG_THRESHOLD) {
      hasDragged = true;
      $calStrip.classList.add('dragging');
    }

    if (!hasDragged) return;

    const x = pageX - $calStrip.offsetLeft;
    const walk = (x - startX) * 1.2;
    $calStrip.scrollLeft = scrollLeft - walk;

    // Track velocity for momentum
    const now = Date.now();
    const dt = now - lastTime;
    if (dt > 0) {
      velocity = (lastX - pageX) / dt; // px/ms
    }
    lastX = pageX;
    lastTime = now;
  }

  function endDrag() {
    if (!isDown) return;
    isDown = false;
    $calStrip.classList.remove('dragging');

    // Apply momentum scrolling if drag occurred
    if (hasDragged && Math.abs(velocity) > 0.15) {
      applyMomentum();
    }
  }

  function applyMomentum() {
    const friction = 0.95;
    const minVelocity = 0.01;

    function step() {
      velocity *= friction;
      if (Math.abs(velocity) < minVelocity) {
        momentumId = null;
        return;
      }
      $calStrip.scrollLeft += velocity * 16; // ~16ms per frame
      momentumId = requestAnimationFrame(step);
    }
    momentumId = requestAnimationFrame(step);
  }

  // Mouse events
  $calStrip.addEventListener('mousedown', (e) => {
    startDrag(e.pageX);
  });

  $calStrip.addEventListener('mouseleave', () => {
    if (isDown) endDrag();
  });

  $calStrip.addEventListener('mouseup', () => {
    endDrag();
  });

  $calStrip.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    moveDrag(e.pageX);
  });

  // Touch events (for mobile draggable calendar strip)
  $calStrip.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      startDrag(e.touches[0].pageX);
    }
  }, { passive: true });

  $calStrip.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      moveDrag(e.touches[0].pageX);
      // Prevent vertical scroll while horizontal dragging
      if (hasDragged) {
        e.preventDefault();
      }
    }
  }, { passive: false });

  $calStrip.addEventListener('touchend', () => {
    endDrag();
  }, { passive: true });

  $calStrip.addEventListener('touchcancel', () => {
    endDrag();
  }, { passive: true });

  // Prevent click events from firing after drag
  $calStrip.addEventListener('click', (e) => {
    if (hasDragged) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // Dynamic month label updating on scroll
  $calStrip.addEventListener('scroll', () => {
    if (window.innerWidth <= 1024) return;
    const children = Array.from($calStrip.children);
    if (children.length === 0) return;

    const containerLeft = $calStrip.getBoundingClientRect().left;
    const firstVisible = children.find(child => {
      const rect = child.getBoundingClientRect();
      return rect.left >= containerLeft - 10;
    }) || children[0];

    const iso = firstVisible.dataset.iso;
    if (iso) {
      const [y, m, d] = iso.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      $calMonthLabel.textContent = `Tháng ${dateObj.getMonth() + 1}, ${dateObj.getFullYear()}`;
    }
  });
}

function renderCalendarStrip(selectedDate, keepOffset = false) {
  const isMobile = window.innerWidth <= 1024;
  $calStrip.innerHTML = '';
  const today = calState.allDates[0];
  const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  if (isMobile) {
    // ---- MOBILE: Show all dates scrollable with Swiper ----
    $calPrev.classList.remove('hidden');
    $calNext.classList.remove('hidden');

    const currentIndex = calState.allDates.findIndex(d => formatDateISO(d) === selectedDate);
    const isFirstDate = currentIndex <= 0;
    const isLastDate = currentIndex === -1 || currentIndex >= calState.allDates.length - 1;

    $calPrev.disabled = isFirstDate;
    $calPrev.style.opacity = isFirstDate ? '0.3' : '1';
    $calPrev.style.pointerEvents = isFirstDate ? 'none' : 'auto';

    $calNext.disabled = isLastDate;
    $calNext.style.opacity = isLastDate ? '0.3' : '1';
    $calNext.style.pointerEvents = isLastDate ? 'none' : 'auto';

    calState.allDates.forEach(date => {
      const iso = formatDateISO(date);
      const isToday = iso === formatDateISO(today);
      const isSelected = iso === selectedDate;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cal-day${isSelected ? ' selected' : ''}`;
      btn.dataset.iso = iso;

      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const isTomorrow = iso === formatDateISO(tomorrow);

      const label = isToday ? 'Nay' : (isTomorrow ? 'Mai' : DAY_LABELS[date.getDay()]);
      btn.innerHTML = `
        <span class="cal-day-num">${date.getDate()}</span>
        <span class="cal-day-label">${label}</span>
      `;

      // Disable today's date if past 8:00 PM (20:00)
      const now = new Date();
      const isPastEightPM = now.getHours() >= 20;
      if (isToday && isPastEightPM) {
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.style.pointerEvents = 'none';
      }

      btn.onclick = () => {
        const currentParams = getParams();
        // Update visual selection immediately
        document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        $timeSlotsContainer.classList.remove('hidden');

        // Update month label based on selected date immediately
        $calMonthLabel.textContent = `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;

        // Center swiper slide immediately
        const selectedIndex = calState.allDates.indexOf(date);
        if (selectedIndex !== -1 && calSwiper) {
          calSwiper.slideTo(selectedIndex, 300);
        }

        // Update date in URL, clear time/branch since they're now stale
        setParams({ date: iso, time: null, time_end: null, branch_id: null }, true);
        // Reload availability in background (shimmer placeholders show up immediately)
        loadAvailability(iso, currentParams.service_id, currentParams.guests).then(() => {
          renderTimeSlots({ ...currentParams, date: iso, time: null });
        });
      };

      // Wrap btn in swiper-slide
      const slide = document.createElement('div');
      slide.className = 'swiper-slide';
      slide.style.width = 'auto';
      slide.appendChild(btn);
      $calStrip.appendChild(slide);
    });

    // Set initial month label based on selectedDate or today
    let selDateObj = today;
    if (selectedDate) {
      const [y, m, d] = selectedDate.split('-').map(Number);
      selDateObj = new Date(y, m - 1, d);
    }
    $calMonthLabel.textContent = `Tháng ${selDateObj.getMonth() + 1}, ${selDateObj.getFullYear()}`;

    // Initialize or update Swiper
    if (calSwiper) {
      calSwiper.destroy(true, true);
      calSwiper = null;
    }

    if (typeof Swiper !== 'undefined') {
      calSwiper = new Swiper('.cal-swiper', {
        slidesPerView: 'auto',
        spaceBetween: 8,
        freeMode: {
          enabled: true,
          sticky: true,
          momentumRatio: 0.25,
          momentumVelocityRatio: 0.5,
        },
        grabCursor: true,
      });

      // Update month label when swiper slides
      calSwiper.on('slideChange', () => {
        const activeIndex = calSwiper.activeIndex;
        const activeDate = calState.allDates[activeIndex];
        if (activeDate) {
          $calMonthLabel.textContent = `Tháng ${activeDate.getMonth() + 1}, ${activeDate.getFullYear()}`;
        }
      });

      // Slide to selected slide instantly
      const selectedIndex = calState.allDates.findIndex(d => formatDateISO(d) === selectedDate);
      if (selectedIndex !== -1) {
        setTimeout(() => {
          calSwiper.slideTo(selectedIndex, 0);
        }, 50);
      }
    }
  } else {
    // Destroy Swiper if moving to desktop
    if (calSwiper) {
      calSwiper.destroy(true, true);
      calSwiper = null;
    }

    // ---- DESKTOP: 1 week per slide (7 columns), navigation changes page ----
    $calPrev.classList.remove('hidden');
    $calNext.classList.remove('hidden');

    $calPrev.style.opacity = '';
    $calPrev.style.pointerEvents = '';
    $calNext.style.opacity = '';
    $calNext.style.pointerEvents = '';

    const totalWeeks = Math.ceil(calState.allDates.length / 7);
    const maxOffset = totalWeeks - 1;

    // Calculate correct weekOffset if selectedDate is set
    if (selectedDate && !keepOffset) {
      const selectedIndex = calState.allDates.findIndex(d => formatDateISO(d) === selectedDate);
      if (selectedIndex !== -1) {
        calState.weekOffset = Math.floor(selectedIndex / 7);
      }
    }

    calState.weekOffset = Math.max(0, Math.min(calState.weekOffset, maxOffset));
    $calPrev.disabled = calState.weekOffset === 0;
    $calNext.disabled = calState.weekOffset >= maxOffset;

    const start = calState.weekOffset * 7;
    const week = calState.allDates.slice(start, start + 7);

    const firstDay = week[0];
    $calMonthLabel.textContent = `Tháng ${firstDay.getMonth() + 1}, ${firstDay.getFullYear()}`;

    week.forEach(date => {
      const iso = formatDateISO(date);
      const isToday = iso === formatDateISO(today);
      const isSelected = iso === selectedDate;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cal-day${isSelected ? ' selected' : ''}`;
      btn.dataset.iso = iso;

      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const isTomorrow = iso === formatDateISO(tomorrow);

      const label = isToday ? 'Nay' : (isTomorrow ? 'Mai' : DAY_LABELS[date.getDay()]);
      btn.innerHTML = `
        <span class="cal-day-num">${date.getDate()}</span>
        <span class="cal-day-label">${label}</span>
      `;

      // Disable today's date if past 8:00 PM (20:00)
      const now = new Date();
      const isPastEightPM = now.getHours() >= 20;
      if (isToday && isPastEightPM) {
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.style.pointerEvents = 'none';
      }

      btn.onclick = () => {
        const currentParams = getParams();
        // Update visual selection immediately
        document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        $timeSlotsContainer.classList.remove('hidden');

        // Update date in URL, clear time/branch since they're now stale
        setParams({ date: iso, time: null, time_end: null, branch_id: null }, true);
        // Reload availability in background (shimmer placeholders show up immediately)
        loadAvailability(iso, currentParams.service_id, currentParams.guests).then(() => {
          renderTimeSlots({ ...currentParams, date: iso, time: null });
        });
      };

      $calStrip.appendChild(btn);
    });
  }
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
  const sumTag = document.getElementById('summary-tag');
  const guestsPill = document.getElementById('summary-guests-pill');
  const $sidebar = document.getElementById('summary-sidebar');

  // Dynamically expand bottom drawer on mobile
  function expandDrawer() {
    const $sidebar = document.getElementById('summary-sidebar');
    const $overlay = document.getElementById('drawer-overlay');
    if (!$sidebar || !$overlay) return;
    
    $sidebar.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    $overlay.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    
    $sidebar.style.transform = 'translateY(0px)';
    $overlay.style.opacity = '1';
    $overlay.style.pointerEvents = 'auto';

    const peekBtn = document.getElementById('btn-drawer-submit-peek');
    const skipContainer = document.getElementById('skip-btn-container');
    if (peekBtn) peekBtn.style.opacity = '0';
    if (skipContainer) skipContainer.style.opacity = '1';

    $sidebar.classList.add('expanded');
    $overlay.classList.add('active');
    document.body.classList.add('no-scroll');
  }

  // Dynamically set the step class on sidebar for responsive CSS styling
  if ($sidebar) {
    $sidebar.className = `summary-sidebar step-${step}`;
    if (step === STEPS.CONFIRMATION) {
      $sidebar.classList.add('hidden');
    }
    // Always start each step with collapsed drawer on mobile
    $sidebar.classList.remove('expanded');
    $sidebar.style.transform = '';
    $sidebar.style.transition = '';
    const $overlay = document.getElementById('drawer-overlay');
    if ($overlay) {
      $overlay.classList.remove('active');
      $overlay.style.opacity = '';
      $overlay.style.transition = '';
      $overlay.style.pointerEvents = '';
    }
    document.body.classList.remove('no-scroll');

    // Auto-scroll up drawer on mobile if user info exists in localStorage and prefilled.
    if (step === STEPS.CUSTOMERINFO && window.innerWidth <= 1024) {
      try {
        const rawCustomer = localStorage.getItem(CUSTOMER_STORAGE_KEY);
        if (rawCustomer) {
          const customerObj = JSON.parse(rawCustomer);
          if (customerObj && customerObj.name && customerObj.phone) {
            setTimeout(() => {
              expandDrawer();
            }, 300);
          }
        }
      } catch (e) {
        console.warn('Error expanding drawer automatically:', e);
      }
    }
  }

  // Sync guest count
  if (guestSelect) {
    guestSelect.value = params.guests;
    // Only allow editing guests in initial steps
    guestSelect.disabled = (step === STEPS.BRANCH || step === STEPS.CUSTOMERINFO);
  }

  if (guestsPill) {
    guestsPill.textContent = `${params.guests} Khách`;
  }

  const showService = step !== STEPS.SERVICES;
  const showTime = !!(params.date && params.time && step !== STEPS.SERVICES && step !== STEPS.TIME);
  const showBranch = !!(branch && (step === STEPS.BRANCH || step === STEPS.CUSTOMERINFO));

  sumServiceSection.classList.toggle('hidden', !showService);
  sumTimeSection.classList.toggle('hidden', !showTime);
  branchInfo.classList.toggle('hidden', !showBranch);
  if ($btnSkipWrap) {
    $btnSkipWrap.classList.toggle('hidden', step !== STEPS.SERVICES);
  }

  const drawerSubmitBtn = document.getElementById('btn-drawer-submit');
  if (drawerSubmitBtn) {
    drawerSubmitBtn.style.display = (step === STEPS.CUSTOMERINFO) ? 'block' : 'none';
  }

  if (sumTag) {
    sumTag.classList.toggle('hidden', step === STEPS.SERVICES);
  }

  // Service info
  if (showService) {
    const isSkipped = !service;
    if (isSkipped) {
      document.getElementById('sum-service-name').textContent = 'Dịch Vụ';
      document.getElementById('sum-service-duration').textContent = '';
      document.getElementById('sum-service-price').textContent = 'Chọn sau ở spa';
      document.getElementById('sum-service-price').style.fontWeight = '400';
      document.getElementById('sum-service-price').style.color = 'var(--_colours---paragraph-dark)';
    } else {
      document.getElementById('sum-service-name').textContent = service.name;
      document.getElementById('sum-service-duration').textContent = `${service.duration_minutes}p`;
      document.getElementById('sum-service-price').textContent = formatPrice(service.price);
      document.getElementById('sum-service-price').style.fontWeight = '';
      document.getElementById('sum-service-price').style.color = '';
    }
  }

  // Time info
  if (showTime) {
    const start12 = formatTime12hSimple(params.time);
    const end12 = formatTime12hSimple(params.time_end);
    document.getElementById('sum-time-range').textContent = `${start12} - ${end12}`;
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
  const start12 = formatTime12hSimple(params.time);
  const end12 = formatTime12hSimple(params.time_end);
  document.getElementById('conf-time-range').textContent = `${start12} — ${end12}`;

  document.getElementById('conf-service-name').textContent = service?.name || 'Chọn sau ở spa';
  const confServicePriceEl = document.getElementById('conf-service-price');
  if (service) {
    confServicePriceEl.textContent = `${formatPrice(service.price)} — ${service.duration_minutes} phút`;
    confServicePriceEl.classList.remove('hidden');
  } else {
    // Hide 0đ and 60min for unselected service
    confServicePriceEl.textContent = '';
    confServicePriceEl.classList.add('hidden');
  }

  document.getElementById('conf-customer-name').textContent = customerData.name;
  document.getElementById('conf-customer-phone').textContent = `${customerData.phone} — ${params.guests} Người`;

  // Populate customer name in footer note (use first name for friendliness)
  const footerNameEl = document.getElementById('conf-footer-customer-name');
  if (footerNameEl) {
    const firstName = customerData.name.split(' ').pop(); // Vietnamese names: last token is given name
    footerNameEl.textContent = firstName || customerData.name;
  }

  const notesRow = document.getElementById('conf-notes-row');
  if (customerData.notes) {
    notesRow.classList.remove('hidden');
    document.getElementById('conf-notes').textContent = customerData.notes;
  } else {
    notesRow.classList.add('hidden');
  }

  if (branch) {
    document.getElementById('conf-branch-name').textContent = branch.address || branch.name;

    // Set branch image in confirmation screen
    const confBranchImg = document.getElementById('conf-branch-img');
    if (confBranchImg) {
      const index = cache.branches.findIndex(b => b.id === branch.id);
      const placeholder = `./images/placeholder-branch${(index === -1 ? 0 : index % 2) + 1}.jpg`;
      confBranchImg.src = branch.image_url || placeholder;
      confBranchImg.style.display = 'block';
    }

    const mapLink = document.querySelector('.conf-direction');
    if (mapLink) {
      if (branch.google_map_url) {
        mapLink.href = branch.google_map_url;
      } else {
        // Use specific Google Maps links per branch if available, otherwise fall back to search
        const BRANCH_MAP_LINKS = {
          // Map branch names to their specific Google Maps URLs from the website
          'CN 1': 'https://maps.app.goo.gl/bce3bzSfE4KNGqcp7',
          'CN 2': 'https://maps.app.goo.gl/m3PdKh93LyTX32XX9',
        };
        // Try to match by branch name
        const specificLink = Object.entries(BRANCH_MAP_LINKS).find(([key]) =>
          branch.name && branch.name.includes(key)
        );
        mapLink.href = specificLink
          ? specificLink[1]
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address || branch.name)}`;
      }
    }
  }
}

// ---- Submission ----

let isSubmitting = false;

async function handleSubmit(e) {
  e.preventDefault();
  if (isSubmitting) return;

  const $btn = document.getElementById('btn-submit');
  const $btnPeek = document.getElementById('btn-drawer-submit-peek');
  const $btnBottom = document.getElementById('btn-drawer-submit-bottom');

  const buttons = [$btn, $btnPeek, $btnBottom].filter(Boolean);

  isSubmitting = true;
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Đang xử lý...';
  });

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
    hold_ids: getSavedHoldIds()
  };

  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      if (res.status === 429) {
        // Block the user locally for 5 minutes
        const blockedUntil = Date.now() + 5 * 60 * 1000;
        localStorage.setItem('spa_booking_blocked_until', String(blockedUntil));
        checkBookingBlock();
        throw new Error('RATE_LIMIT_BLOCKED');
      }
      throw new Error(err.error || 'Booking failed');
    }

    stopCountdown();
    clearHoldStorage();

    saveCustomerToStorage(customerData);
    populateConfirmation(params, customerData);
    navigateTo(STEPS.CONFIRMATION);
  } catch (err) {
    if (err.message === 'RATE_LIMIT_BLOCKED') {
      showToast('Bạn đã đặt lịch quá nhiều lần trong khoảng thời gian ngắn. Vui lòng đợi 5 phút để có thể đặt lịch mới hoặc liên hệ <a href="https://zalo.me/0968241808" style="color: inherit; text-decoration:underline; text-underline-offset:3px;" target="_blank" rel="noopener noreferrer">Zalo</a> để được hỗ trợ nhanh nhất.', 12000);
    } else {
      showToast(`Đặt lịch thất bại: ${err.message}`, 8000);
    }
  } finally {
    isSubmitting = false;
    const isBlocked = checkBookingBlock();
    buttons.forEach(btn => {
      if (!isBlocked) {
        btn.disabled = false;
      }
      btn.textContent = btn.dataset.originalText || (btn.id === 'btn-submit' ? 'Đặt Lịch' : 'Xác Nhận Đặt Lịch');
    });
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

function formatTime12h(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const hFormatted = String(h12).padStart(2, '0');
  const mFormatted = String(m).padStart(2, '0');
  return [`${hFormatted}:${mFormatted}`, period];
}

function formatTime12hSimple(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr);
  if (isNaN(h)) return timeStr;
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
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
    notes: customerData.notes || '',
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

function getSavedCustomerData() {
  try {
    const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!raw) return { name: 'Khách', phone: '', email: '', notes: '' };
    return JSON.parse(raw);
  } catch (_) {
    return { name: 'Khách', phone: '', email: '', notes: '' };
  }
}

let blockCheckInterval = null;

/**
 * Checks if the user is currently blocked from making bookings.
 * If blocked, disables and reduces opacity of submit buttons, and starts an interval to restore them when expired.
 */
function checkBookingBlock() {
  const blockedUntilStr = localStorage.getItem('spa_booking_blocked_until');
  if (!blockedUntilStr) return false;

  const blockedUntil = parseInt(blockedUntilStr, 10);
  if (isNaN(blockedUntil)) return false;

  const now = Date.now();
  const buttons = [
    document.getElementById('btn-submit'),
    document.getElementById('btn-drawer-submit-peek'),
    document.getElementById('btn-drawer-submit-bottom')
  ].filter(Boolean);

  if (now < blockedUntil) {
    // User is currently blocked
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.3';
      btn.style.pointerEvents = 'none';
    });

    // Start interval to automatically unblock when the time has passed
    if (!blockCheckInterval) {
      blockCheckInterval = setInterval(() => {
        const isStillBlocked = checkBookingBlock();
        if (!isStillBlocked) {
          clearInterval(blockCheckInterval);
          blockCheckInterval = null;
          console.log('🔓 Rate limit block expired. Submit buttons restored.');
        }
      }, 3000);
    }
    return true;
  } else {
    // Block has expired, clean up styles
    localStorage.removeItem('spa_booking_blocked_until');
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    });
    return false;
  }
}

// =============================================
// Slot Hold & Countdown Timer System Helpers
// =============================================

const HOLD_IDS_KEY = 'spa_hold_ids';
const HOLD_EXPIRES_KEY = 'spa_hold_expires';
const HOLD_PARAMS_KEY = 'spa_hold_params';

let countdownInterval = null;

function saveHoldToStorage(holdIds, expiresAt, params) {
  localStorage.setItem(HOLD_IDS_KEY, JSON.stringify(holdIds));
  localStorage.setItem(HOLD_EXPIRES_KEY, String(expiresAt));
  localStorage.setItem(HOLD_PARAMS_KEY, JSON.stringify(params));
}

function getSavedHoldIds() {
  try {
    const raw = localStorage.getItem(HOLD_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function getSavedHoldExpires() {
  const raw = localStorage.getItem(HOLD_EXPIRES_KEY);
  return raw ? parseInt(raw) : 0;
}

function getSavedHoldParams() {
  try {
    const raw = localStorage.getItem(HOLD_PARAMS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearHoldStorage() {
  localStorage.removeItem(HOLD_IDS_KEY);
  localStorage.removeItem(HOLD_EXPIRES_KEY);
  localStorage.removeItem(HOLD_PARAMS_KEY);
}

function startCountdown(expiresAt) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  const $countdown = document.getElementById('booking-countdown');
  const $countdownMobile = document.getElementById('booking-countdown-mobile');

  const $timerVal = document.getElementById('countdown-timer-val');
  const $timerValMobile = document.getElementById('countdown-timer-val-mobile');

  // Show the countdown UI, removing skeleton class to draw actual numbers
  if ($countdown) {
    $countdown.classList.remove('hidden', 'timer-skeleton');
  }
  if ($countdownMobile) {
    $countdownMobile.classList.remove('hidden');
  }
  document.body.classList.add('has-countdown');

  function updateTimer() {
    const now = Date.now();
    const remaining = expiresAt - now;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      if ($timerVal) $timerVal.textContent = '00:00s';
      if ($timerValMobile) $timerValMobile.textContent = '00:00s';
      handleHoldExpiration();
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    const minutesStr = String(minutes).padStart(2, '0');
    const secondsStr = String(seconds).padStart(2, '0');
    const formatted = `${minutesStr}:${secondsStr}s`;

    if ($timerVal) $timerVal.textContent = formatted;
    if ($timerValMobile) $timerValMobile.textContent = formatted;
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const $countdown = document.getElementById('booking-countdown');
  const $countdownMobile = document.getElementById('booking-countdown-mobile');

  if ($countdown) {
    $countdown.classList.add('hidden');
    $countdown.classList.remove('timer-skeleton');
  }
  if ($countdownMobile) {
    $countdownMobile.classList.add('hidden');
  }

  document.body.classList.remove('has-countdown');
}

async function handleHoldExpiration() {
  stopCountdown();

  const holdIds = getSavedHoldIds();
  clearHoldStorage();

  if (holdIds && holdIds.length > 0) {
    try {
      const qs = new URLSearchParams({ hold_ids: holdIds.join(',') });
      await fetch(`${API_BASE}/bookings/hold?${qs.toString()}`, {
        method: 'DELETE'
      });
      console.log('Expired hold bookings deleted from DB');
    } catch (err) {
      console.error('Error deleting expired holds:', err);
    }
  }

  // Show premium toast notification with clickable links
  const toastMsg = `Ý rất tiếc, đã hết thời gian giữ chỗ rồi. Bạn hãy đặt lại lịch khác nhé. Nếu cần gì hỗ trợ, bạn hãy liên hệ qua <a href="https://m.me/61573340536773?text=Hi,%20%C3%9D%20cho%20m%C3%ACnh%20%C4%91%E1%BA%B7t%20l%E1%BB%8Bch%207h%20t%E1%BB%91i%20nay%20%E1%BB%9F%20CN%201%20ho%E1%BA%B7c%202%20nh%C3%A9." target="_blank" rel="noopener noreferrer">Fanpage</a> hoặc <a href="https://zalo.me/0968241808" target="_blank" rel="noopener noreferrer">Zalo</a> để Ý hỗ trợ mình đặt lịch nghen ^^.`;
  showToast(toastMsg, 10000);

  clearBookingParams();
}

function clearBookingParams() {
  const current = new URLSearchParams(window.location.search);
  current.delete('book');
  current.delete('booking');
  current.delete('date');
  current.delete('time');
  current.delete('time_end');
  current.delete('branch_id');

  // Set the step back to timing to preserve the selected service
  current.set('step', STEPS.TIME);

  const url = `${window.location.pathname}?${current.toString()}`;
  window.history.replaceState(null, '', url);
  handleRouting();
}

function showToast(message, durationMs = 10000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'custom-toast';

  const text = document.createElement('div');
  text.className = 'toast-message';
  text.innerHTML = message;
  toast.appendChild(text);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 400);
  };
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 400);
  }, durationMs);
}

async function releaseHoldIfNavigatedAway(newStep) {
  stopCountdown();
  const holdIds = getSavedHoldIds();
  if (holdIds && holdIds.length > 0) {
    clearHoldStorage();
    try {
      const qs = new URLSearchParams({ hold_ids: holdIds.join(',') });
      await fetch(`${API_BASE}/bookings/hold?${qs.toString()}`, {
        method: 'DELETE'
      });
      console.log('Hold bookings released due to navigation to step:', newStep);
    } catch (err) {
      console.error('Error releasing hold bookings:', err);
    }
  }
}

async function handleHoldState(params) {
  const savedHoldIds = getSavedHoldIds();
  const savedExpires = getSavedHoldExpires();
  const savedParams = getSavedHoldParams();

  // Check if we have a valid saved hold matching current selections
  const matches = savedParams &&
    savedParams.branch_id === params.branch_id &&
    savedParams.date === params.date &&
    savedParams.time === params.time &&
    savedParams.guests === params.guests &&
    savedParams.service_id === params.service_id;

  const isValid = matches && savedHoldIds.length > 0 && savedExpires > Date.now();

  if (isValid) {
    console.log('Resuming existing hold countdown...');
    startCountdown(savedExpires);
  } else {
    // Check if the user is currently rate-limited/blocked
    const blockedUntilStr = localStorage.getItem('spa_booking_blocked_until');
    const isBlocked = blockedUntilStr && parseInt(blockedUntilStr, 10) > Date.now();

    if (isBlocked) {
      console.log('⚡ User is blocked due to rate limiting. Skipping slot hold request.');
      stopCountdown();
      
      const buttons = [
        document.getElementById('btn-submit'),
        document.getElementById('btn-drawer-submit-peek'),
        document.getElementById('btn-drawer-submit-bottom')
      ].filter(Boolean);

      buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.style.pointerEvents = 'none';
      });

      showToast('Bạn đã đặt lịch quá nhiều lần trong khoảng thời gian ngắn. Vui lòng đợi 5 phút để có thể đặt lịch mới hoặc liên hệ <a href="https://zalo.me/0968241808" style="color: inherit; text-decoration:underline; text-underline-offset:3px;" target="_blank" rel="noopener noreferrer">Zalo</a> để được hỗ trợ nhanh nhất.', 12000);
      return;
    }

    console.log('Creating a new slot hold...');

    if (savedHoldIds.length > 0) {
      try {
        const qs = new URLSearchParams({ hold_ids: savedHoldIds.join(',') });
        fetch(`${API_BASE}/bookings/hold?${qs.toString()}`, { method: 'DELETE' }).catch(() => { });
      } catch (_) { }
    }

    clearHoldStorage();

    const $btnSubmit = document.getElementById('btn-submit');
    const $btnPeek = document.getElementById('btn-drawer-submit-peek');
    const $btnBottom = document.getElementById('btn-drawer-submit-bottom');

    const buttons = [$btnSubmit, $btnPeek, $btnBottom].filter(Boolean);
    
    // Toggle skeleton load class on submit buttons during wait API instead of layout shift / text changes
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('button-skeleton');
    });

    // Render skeleton loader for countdown timer on desktop instead of layout shift
    const $countdown = document.getElementById('booking-countdown');
    if ($countdown) {
      $countdown.classList.remove('hidden');
      $countdown.classList.add('timer-skeleton');
    }

    try {
      const holdDuration = 5 * 60 * 1000; // 5 minutes
      const expiresAt = Date.now() + holdDuration;

      const payload = {
        branch_id: params.branch_id,
        service_id: params.service_id || null,
        num_guests: params.guests,
        booking_date: params.date,
        start_time: params.time,
        hold_duration: holdDuration
      };

      const res = await fetch(`${API_BASE}/bookings/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Giữ chỗ thất bại');
      }

      const data = await res.json();
      const holdIds = data.hold_ids;

      // Check if user navigated away while the request was in flight
      const currentParams = getParams();
      if (currentParams.step !== STEPS.CUSTOMERINFO) {
        console.log('User navigated away while hold was being created. Releasing hold immediately.');
        if (holdIds && holdIds.length > 0) {
          const qs = new URLSearchParams({ hold_ids: holdIds.join(',') });
          fetch(`${API_BASE}/bookings/hold?${qs.toString()}`, { method: 'DELETE' }).catch(() => { });
        }
        return;
      }

      saveHoldToStorage(holdIds, expiresAt, params);
      startCountdown(expiresAt);

    } catch (err) {
      // Only alert and redirect if the user is still on the customerinfo step
      const currentParams = getParams();
      if (currentParams.step === STEPS.CUSTOMERINFO) {
        alert('Khung giờ này đã bị giữ hoặc hết chỗ. Vui lòng chọn khung giờ khác!');
        navigateTo(STEPS.TIME);
      }
    } finally {
      buttons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('button-skeleton');
      });
    }
  }
}