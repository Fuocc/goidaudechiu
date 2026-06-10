export function savePreferenceToDB(prefs) {
  if (!window.indexedDB) return;
  const request = indexedDB.open('yoi_settings_db', 1);

  request.onupgradeneeded = function(e) {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('prefs')) {
      db.createObjectStore('prefs');
    }
  };

  request.onsuccess = function(e) {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('prefs')) return;
    const transaction = db.transaction(['prefs'], 'readwrite');
    const store = transaction.objectStore('prefs');
    store.put(prefs, 'notifications');
  };
}
