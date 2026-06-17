import './style.css';
import { render, tryAutoReconnect } from './ui.js';

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
  // Try to reconnect from saved session, otherwise render login
  await tryAutoReconnect();
});
