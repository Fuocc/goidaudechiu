import { useState, useEffect, useCallback, useRef } from 'react';
import { request } from '../api';

// Sau khi đăng ký thất bại, không tự động thử lại trong khoảng thời gian này
// (tránh vòng lặp subscribe → lỗi → subscribe khi backend đang ngủ hoặc trình duyệt không hỗ trợ push).
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FAIL_KEY = 'yoi_push_fail_at';

// Helper chuyển đổi base64 của VAPID sang mảng Uint8Array
function urlBase64ToUint8Array(base64String) {
  const clean = base64String.trim();
  const padding = '='.repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function markFailed() {
  try { localStorage.setItem(FAIL_KEY, String(Date.now())); } catch (e) { /* ignore */ }
}

function clearFailed() {
  try { localStorage.removeItem(FAIL_KEY); } catch (e) { /* ignore */ }
}

export function isInPushCooldown() {
  try {
    const at = parseInt(localStorage.getItem(FAIL_KEY) || '0', 10);
    return at > 0 && Date.now() - at < RETRY_COOLDOWN_MS;
  } catch (e) {
    return false;
  }
}

// So sánh applicationServerKey của subscription hiện tại với VAPID key của server
function isSameKey(subscription, keyBytes) {
  const current = subscription?.options?.applicationServerKey;
  if (!current) return true; // Trình duyệt không cho đọc key → coi như khớp
  const a = new Uint8Array(current);
  if (a.length !== keyBytes.length) return false;
  return a.every((v, i) => v === keyBytes[i]);
}

export function useWebPush() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const checkSupport = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setIsSupported(checkSupport);

    if (checkSupport) {
      setPermission(Notification.permission);
      checkCurrentSubscription();
    } else {
      setLoading(false);
    }
  }, []);

  // Kiểm tra xem trình duyệt đã đăng ký push thành công với backend chưa
  async function checkCurrentSubscription() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);

      // Tự động đồng bộ lại với Backend để tránh bị mất trong database (Self-healing)
      if (subscription) {
        request('/notifications/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription })
        }).catch((err) => console.warn('[push] Không đồng bộ được subscription:', err.message));
      }
    } catch (err) {
      console.warn('[push] Không kiểm tra được subscription:', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Bắt đầu đăng ký cấp quyền và liên kết VAPID Key.
  // silent = true: gọi tự động (không hiện alert, không thử lại trong thời gian cooldown).
  const subscribe = useCallback(async ({ silent = false } = {}) => {
    if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) {
      return { ok: false, error: 'Trình duyệt không hỗ trợ thông báo đẩy.' };
    }
    if (inFlightRef.current) return { ok: false, error: 'Đang đăng ký...' };
    if (silent && isInPushCooldown()) return { ok: false, error: 'cooldown' };

    inFlightRef.current = true;
    setLoading(true);

    try {
      // 1. Yêu cầu quyền thông báo của OS/Browser
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        throw new Error('Quyền thông báo bị từ chối.');
      }

      // 2. Lấy Public Key VAPID từ Backend
      const { publicKey } = await request('/notifications/vapid-public-key');
      if (!publicKey) {
        throw new Error('Không lấy được Public Key từ máy chủ.');
      }
      const convertedKey = urlBase64ToUint8Array(publicKey);

      // 3. Đăng ký nhận Push thông qua PushManager của Trình duyệt.
      // Nếu còn subscription cũ tạo bằng VAPID key khác → hủy trước, nếu không trình duyệt sẽ báo lỗi.
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing && !isSameKey(existing, convertedKey)) {
        await existing.unsubscribe().catch(() => {});
      }

      const options = { userVisibleOnly: true, applicationServerKey: convertedKey };
      let subscription;
      try {
        subscription = await registration.pushManager.subscribe(options);
      } catch (firstErr) {
        // Thử lại 1 lần sau khi dọn subscription hỏng (hay gặp khi đổi VAPID key hoặc dữ liệu push cũ bị lỗi)
        const stale = await registration.pushManager.getSubscription();
        if (stale) await stale.unsubscribe().catch(() => {});
        subscription = await registration.pushManager.subscribe(options).catch(() => { throw firstErr; });
      }

      // 4. Gửi thông tin Subscription Object lên Backend để lưu trữ vào Database
      await request('/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription })
      });

      clearFailed();
      setError(null);
      setIsSubscribed(true);
      return { ok: true };
    } catch (err) {
      markFailed();
      setError(err.message);
      console.warn('[push] Đăng ký nhận thông báo lỗi:', err.message);
      if (!silent) {
        alert('Đăng ký nhận thông báo lỗi: ' + err.message);
      }
      return { ok: false, error: err.message };
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Hủy đăng ký nhận thông báo (Unsubscribe)
  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator && 'PushManager' in window)) return false;
    setLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // 1. Gửi lệnh báo hủy lên Backend để xóa trong DB
        await request('/notifications/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint: subscription.endpoint })
        }).catch((err) => console.warn('[push] Không hủy được trên server:', err.message));

        // 2. Hủy đăng ký nhận đẩy trên trình duyệt
        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.warn('[push] Hủy đăng ký lỗi:', err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    error,
    subscribe,
    unsubscribe
  };
}
