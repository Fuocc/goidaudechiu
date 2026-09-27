// Ép Service Worker mới kích hoạt ngay lập tức khi cài đặt
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

// Ép Service Worker kiểm soát tất cả các tab ngay khi được kích hoạt
self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});

// Lắng nghe sự kiện đẩy (Push Event) từ Server gửi tới.
// Lọc theo chi nhánh đã được làm ở server (push_subscriptions.muted_branch_ids): đăng ký với userVisibleOnly
// nên mọi push nhận được đều PHẢI hiện thông báo, không được bỏ qua ở đây (Chrome sẽ hiện thông báo mặc định
// và có thể thu hồi quyền push).
self.addEventListener('push', function (event) {
  event.waitUntil((async () => {
    let data = { title: 'Ý Ơi Spa', body: 'Bạn có một thông báo mới từ hệ thống!' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Ý Ơi Spa', body: event.data.text() };
    }
  }

    const options = {
      body: data.body,
      icon: data.icon || '/favicon-256x256.png',
      badge: data.badge || '/favicon-256x256.png',
      vibrate: [100, 50, 100],
      tag: 'yoi-new-booking',
      renotify: true,
      data: {
        url: data.url || '/bookings'
      },
      actions: [
        { action: 'open_url', title: 'Xem chi tiết lịch 📅' }
      ]
    };

    return self.registration.showNotification(data.title, options);
  })());
});

// Lắng nghe sự kiện người dùng Click vào thông báo (Notification Click)
self.addEventListener('notificationclick', function (event) {
  event.notification.close(); // Đóng thông báo lập tiếp

  const targetUrl = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Nếu có sẵn cửa sổ dashboard đang mở, điều hướng và tập trung (focus) vào nó
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Nếu chưa có tab nào mở, mở tab mới
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
