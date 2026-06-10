// Ép Service Worker mới kích hoạt ngay lập tức khi cài đặt
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

// Ép Service Worker kiểm soát tất cả các tab ngay khi được kích hoạt
self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});

// Hàm hỗ trợ đọc cấu hình từ IndexedDB
function getPreferenceFromDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open('yoi_settings_db', 1);
    
    request.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('prefs')) {
        db.createObjectStore('prefs');
      }
    };

    request.onsuccess = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('prefs')) {
        resolve(null);
        return;
      }
      const transaction = db.transaction(['prefs'], 'readonly');
      const store = transaction.objectStore('prefs');
      const getReq = store.get('notifications');
      
      getReq.onsuccess = function() { resolve(getReq.result); };
      getReq.onerror = function() { resolve(null); };
    };

    request.onerror = function() { resolve(null); };
  });
}

// Lắng nghe sự kiện đẩy (Push Event) từ Server gửi tới
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

    // --- Lọc thông báo dựa trên cài đặt chi nhánh ---
    if (data.branch_id) {
      const prefs = await getPreferenceFromDB() || { branch1: true, branch2: true };
      if (data.branch_id === 1 && !prefs.branch1) return;
      if (data.branch_id === 2 && !prefs.branch2) return;
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
