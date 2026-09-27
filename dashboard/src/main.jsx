import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { viVN } from '@clerk/localizations';
import App from './App';
import './index.css';
import { Provider } from "./components/ui/provider";

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_placeholder';

// iOS Safari tự phóng to khi chạm vào ô nhập có chữ < 16px (giao diện mobile đang dùng 14px).
// Chỉ trên iOS gắn maximum-scale=1: iOS vẫn cho người dùng pinch-zoom (Safari bỏ qua giới hạn này khi tự zoom)
// nhưng không còn tự zoom khi focus. Android/desktop không bị giới hạn phóng to.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS báo là Mac
if (isIOS) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && !/maximum-scale/.test(viewport.content)) {
    viewport.content = `${viewport.content}, maximum-scale=1`;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} localization={viVN}>
        <Provider>
          <App />
        </Provider>
      </ClerkProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Register Service Worker for VAPID Web Push Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => {})
      .catch(() => {});
  });
}

