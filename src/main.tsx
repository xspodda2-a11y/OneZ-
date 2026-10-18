import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { useGame } from './state/store';
import './styles/ui.css';

const el = document.getElementById('app');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Title screen on first paint
useGame.getState().setScreen('menu');

// Suppress the browser context menu on the canvas (right click is block)
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Surface unexpected errors in the interface instead of dying silently.
window.addEventListener('error', (e) => {
  console.error(e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});
