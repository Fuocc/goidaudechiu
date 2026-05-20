import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

// Helper chuyển đổi base64 của VAPID sang mảng Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPush() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSupport = 'serviceWorker' in navigator && 'PushManager' in window;
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
        fetch(`${API_BASE}/notifications/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription })
        }).catch(err => console.warn('Đồng bộ tự động Web Push thất bại:', err));
      }
    } catch (err) {
      console.error('Lỗi khi kiểm tra Push Subscription:', err);
    } finally {
      setLoading(false);
    }
  }

  // Bắt đầu đăng ký cấp quyền và liên kết VAPID Key
  async function subscribe() {
    if (!isSupported) return;
    setLoading(true);

    try {
      // 1. Yêu cầu quyền thông báo của OS/Browser
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        throw new Error('Quyền thông báo bị từ chối.');
      }

      // 2. Lấy Public Key VAPID từ Backend
      const resKey = await fetch(`${API_BASE}/notifications/vapid-public-key`);
      const { publicKey } = await resKey.json();
      
      if (!publicKey) {
        throw new Error('Không lấy được Public Key từ máy chủ.');
      }

      // 3. Đăng ký nhận Push thông qua PushManager của Trình duyệt
      const registration = await navigator.serviceWorker.ready;
      const convertedKey = urlBase64ToUint8Array(publicKey);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });

      // 4. Gửi thông tin Subscription Object lên Backend để lưu trữ vào Database
      const resSubscribe = await fetch(`${API_BASE}/notifications/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });

      if (!resSubscribe.ok) {
        throw new Error('Không thể đăng ký Subscription với Server.');
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error('❌ Đăng ký Web Push thất bại:', err);
      alert('Đăng ký nhận thông báo lỗi: ' + err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }

  // Hủy đăng ký nhận thông báo (Unsubscribe)
  async function unsubscribe() {
    if (!isSupported) return;
    setLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // 1. Gửi lệnh báo hủy lên Backend để xóa trong DB
        await fetch(`${API_BASE}/notifications/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });

        // 2. Hủy đăng ký nhận đẩy trên trình duyệt
        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error('❌ Hủy đăng ký Web Push thất bại:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    subscribe,
    unsubscribe
  };
}
