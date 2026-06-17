import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

let client = null;
let sessionString = '';

/**
 * Get or create the TelegramClient instance.
 */
export function getClient() {
  return client;
}

/**
 * Check if we have a saved session in localStorage.
 */
export function hasSavedSession() {
  return !!localStorage.getItem('xabarbot_session');
}

/**
 * Get saved credentials from localStorage.
 */
export function getSavedCredentials() {
  const data = localStorage.getItem('xabarbot_credentials');
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get client options that spoof an official Web client
 */
function getClientOptions() {
  const isBrowser = typeof window !== 'undefined' && typeof window.navigator !== 'undefined';
  const ua = isBrowser ? navigator.userAgent : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const system = isBrowser ? (navigator.oscpu || navigator.platform || 'Win32') : 'Windows';
  const lang = isBrowser ? (navigator.language || 'uz').slice(0, 2) : 'uz';

  return {
    connectionRetries: 5,
    deviceModel: ua.substring(0, 100),
    systemVersion: system.substring(0, 30),
    appVersion: '2.1.8', // Telegram Web K official version
    langCode: lang,
    systemLangCode: lang,
  };
}

/**
 * Connect to Telegram using saved session (auto-reconnect).
 * Returns true if reconnected successfully.
 */
export async function reconnectFromSession() {
  const savedSession = localStorage.getItem('xabarbot_session');
  const creds = getSavedCredentials();
  if (!savedSession || !creds) return false;

  try {
    const session = new StringSession(savedSession);
    client = new TelegramClient(session, Number(creds.apiId), creds.apiHash, getClientOptions());
    await client.connect();

    // Verify the connection is alive
    const me = await client.getMe();
    if (me) {
      return true;
    }
    return false;
  } catch (err) {
    console.error('Reconnect failed:', err);
    client = null;
    return false;
  }
}

/**
 * Start the Telegram login process.
 * @param {object} params
 * @param {string} params.apiId
 * @param {string} params.apiHash
 * @param {string} params.phoneNumber
 * @param {function} params.onCodeRequest - async function that returns the SMS code
 * @param {function} params.onPasswordRequest - async function that returns the 2FA password
 * @param {function} params.onError - called on error
 */
export async function loginToTelegram({ apiId, apiHash, phoneNumber, onCodeRequest, onPasswordRequest, onError }) {
  try {
    const session = new StringSession('');
    client = new TelegramClient(session, Number(apiId), apiHash, getClientOptions());

    await client.start({
      phoneNumber: () => phoneNumber,
      phoneCode: async () => {
        const code = await onCodeRequest();
        if (code === null || code === undefined) {
          throw new Error('SMS kod kiritish bekor qilindi');
        }
        return code;
      },
      password: async () => {
        const pass = await onPasswordRequest();
        if (pass === null || pass === undefined) {
          throw new Error('2FA parol kiritish bekor qilindi');
        }
        return pass;
      },
      onError: (err) => {
        console.error('Auth error:', err);
        if (onError) onError(err);
      },
    });

    // Save session
    sessionString = client.session.save();
    localStorage.setItem('xabarbot_session', sessionString);
    localStorage.setItem('xabarbot_credentials', JSON.stringify({ apiId, apiHash }));

    return true;
  } catch (err) {
    console.error('Login failed:', err);
    client = null;
    throw err;
  }
}

/**
 * Get current user info.
 */
export async function getCurrentUser() {
  if (!client) return null;
  try {
    return await client.getMe();
  } catch {
    return null;
  }
}

/**
 * Disconnect and clear session.
 */
export async function logout() {
  if (client) {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
  client = null;
  localStorage.removeItem('xabarbot_session');
  localStorage.removeItem('xabarbot_credentials');
}
