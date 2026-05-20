// Ép Service Worker mới kích hoạt ngay lập tức khi cài đặt
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

// Ép Service Worker kiểm soát tất cả các tab ngay khi được kích hoạt
self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});

// Lắng nghe sự kiện đẩy (Push Event) từ Server gửi tới
self.addEventListener('push', function (event) {
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
    icon: data.icon || '/public/favicon-256x256.png', // Sử dụng favicon logo thực tế của spa
    badge: data.badge || '/public/favicon-256x256.png', // Badge hiển thị nhỏ trên thiết bị di động
    vibrate: [100, 50, 100], // Kiểu rung trên điện thoại Android
    tag: 'yoi-new-booking', // Gom nhóm thông báo lịch đặt mới, tránh spam tràn lan màn hình
    renotify: true, // Kích hoạt phát chuông và rung lại khi có thông báo mới cùng tag xếp chồng
    data: {
      url: data.url || '/bookings' // URL để điều hướng khi click
    },
    actions: [
      { action: 'open_url', title: 'Xem chi tiết lịch 📅' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
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
