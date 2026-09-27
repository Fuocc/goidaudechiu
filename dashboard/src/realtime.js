import { API_BASE, request } from './api';

/**
 * Kết nối realtime (SSE) DÙNG CHUNG cho toàn dashboard.
 * - Trước đây Sidebar và Bookings mỗi nơi mở 1 EventSource + 1 kênh Supabase Realtime riêng.
 * - EventSource không gửi được header Authorization → xin "vé" ngắn hạn (60s, dùng 1 lần) qua API có đăng nhập,
 *   rồi mở kết nối bằng vé đó. Mỗi lần kết nối lại đều xin vé mới.
 * - Sự kiện phát ra trong lúc mất kết nối sẽ bị lỡ → sau khi kết nối LẠI, phát sự kiện nội bộ
 *   REALTIME_RECONNECTED để nơi dùng tự tải lại dữ liệu.
 */

// Sự kiện nội bộ (không đến từ server): đã kết nối lại sau khi bị đứt
export const REALTIME_RECONNECTED = 'realtime.reconnected';

const listeners = new Map(); // eventName -> Set<handler>
let eventSource = null;
let reconnectTimer = null;
let retryDelay = 3000;
let connecting = false;
let hadConnection = false; // đã từng kết nối thành công → lần 'connected' tiếp theo là kết nối lại
let windowListenersAttached = false;

const sseUrl = () => API_BASE.replace(/\/api\/?$/, '') + '/api/events';

const attachedEvents = new WeakMap(); // EventSource -> Set<eventName> (tránh gắn trùng listener)

function dispatch(eventName, data) {
  (listeners.get(eventName) || []).forEach((handler) => {
    try { handler(data); } catch (err) { console.error('[realtime] handler lỗi:', err); }
  });
}

function attach(source, eventName) {
  if (eventName === REALTIME_RECONNECTED) return; // sự kiện nội bộ, server không gửi
  if (!attachedEvents.has(source)) attachedEvents.set(source, new Set());
  const attached = attachedEvents.get(source);
  if (attached.has(eventName)) return;
  attached.add(eventName);

  source.addEventListener(eventName, (e) => {
    let data = null;
    try { data = JSON.parse(e.data); } catch (err) { data = null; }
    dispatch(eventName, data);
  });
}

function scheduleReconnect() {
  if (reconnectTimer || listeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60000); // giãn cách dần khi server ngủ / mất mạng
}

async function connect() {
  if (connecting || eventSource || listeners.size === 0) return;
  connecting = true;
  try {
    const { ticket } = await request('/events/ticket');
    // Trong lúc chờ vé, mọi nơi đã hủy đăng ký (VD đăng xuất) → không mở kết nối nữa
    if (listeners.size === 0) return;
    const source = new EventSource(`${sseUrl()}?ticket=${encodeURIComponent(ticket)}`);
    eventSource = source;

    source.addEventListener('connected', () => {
      retryDelay = 3000;
      if (hadConnection) dispatch(REALTIME_RECONNECTED, null);
      hadConnection = true;
    });
    listeners.forEach((_, eventName) => attach(source, eventName));

    source.onerror = () => {
      source.close();
      if (eventSource === source) eventSource = null;
      scheduleReconnect();
    };
  } catch (err) {
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

// Có mạng lại / tab hiện lại → kết nối ngay thay vì chờ hết thời gian giãn cách (có thể tới 60s)
function reconnectNow() {
  if (listeners.size === 0 || connecting) return;
  // Trình duyệt di động có thể đóng kết nối ngầm khi app chạy nền mà không báo onerror
  if (eventSource && eventSource.readyState === EventSource.CLOSED) eventSource = null;
  if (eventSource) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  retryDelay = 3000;
  connect();
}

function ensureWindowListeners() {
  if (windowListenersAttached || typeof window === 'undefined') return;
  windowListenersAttached = true;
  window.addEventListener('online', reconnectNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow();
  });
}

/**
 * Đăng ký nghe 1 hoặc nhiều sự kiện. Trả về hàm hủy đăng ký.
 * @param {Record<string, (data: any) => void>} handlers VD { 'booking.created': fn, [REALTIME_RECONNECTED]: fn }
 */
export function subscribeRealtime(handlers) {
  const entries = Object.entries(handlers);
  ensureWindowListeners();

  entries.forEach(([eventName, handler]) => {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(handler);
    // Kết nối đang mở → gắn thêm sự kiện mới (attach tự bỏ qua nếu đã gắn)
    if (eventSource) attach(eventSource, eventName);
  });

  connect();

  return () => {
    entries.forEach(([eventName, handler]) => {
      const set = listeners.get(eventName);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) listeners.delete(eventName);
    });
    if (listeners.size === 0) {
      if (eventSource) eventSource.close();
      eventSource = null;
      hadConnection = false; // lần đăng ký sau (VD đăng nhập lại) là kết nối mới, không phải kết nối lại
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
}
