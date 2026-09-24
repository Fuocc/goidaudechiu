import { API_BASE, request } from './api';

/**
 * Kết nối realtime (SSE) DÙNG CHUNG cho toàn dashboard.
 * - Trước đây Sidebar và Bookings mỗi nơi mở 1 EventSource + 1 kênh Supabase Realtime riêng.
 * - EventSource không gửi được header Authorization → xin "vé" ngắn hạn (60s, dùng 1 lần) qua API có đăng nhập,
 *   rồi mở kết nối bằng vé đó. Mỗi lần kết nối lại đều xin vé mới.
 */
const listeners = new Map(); // eventName -> Set<handler>
let eventSource = null;
let reconnectTimer = null;
let retryDelay = 3000;
let connecting = false;

const sseUrl = () => API_BASE.replace(/\/api\/?$/, '') + '/api/events';

const attachedEvents = new WeakMap(); // EventSource -> Set<eventName> (tránh gắn trùng listener)

function attach(source, eventName) {
  if (!attachedEvents.has(source)) attachedEvents.set(source, new Set());
  const attached = attachedEvents.get(source);
  if (attached.has(eventName)) return;
  attached.add(eventName);

  source.addEventListener(eventName, (e) => {
    let data = null;
    try { data = JSON.parse(e.data); } catch (err) { data = null; }
    (listeners.get(eventName) || []).forEach((handler) => {
      try { handler(data); } catch (err) { console.error('[realtime] handler lỗi:', err); }
    });
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
    const source = new EventSource(`${sseUrl()}?ticket=${encodeURIComponent(ticket)}`);
    eventSource = source;

    source.addEventListener('connected', () => { retryDelay = 3000; });
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

/**
 * Đăng ký nghe 1 hoặc nhiều sự kiện. Trả về hàm hủy đăng ký.
 * @param {Record<string, (data: any) => void>} handlers VD { 'booking.created': fn }
 */
export function subscribeRealtime(handlers) {
  const entries = Object.entries(handlers);

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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
}
