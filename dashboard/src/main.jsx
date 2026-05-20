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
      .then(reg => {
        console.log('✅ Service Worker registered successfully on scope:', reg.scope);
      })
      .catch(err => {
        console.error('❌ Service Worker registration failed:', err);
      });
  });
}

