import { getClient } from './auth.js';
import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads.js';

/**
 * Sent history manager.
 * Tracks which users have been messaged in which group/channel.
 * Stored in localStorage as local cache, and synced with Telegram channel "Bu Kanalni Ochirmang".
 */

const STORAGE_KEY = 'xabarbot_sent_history';
let dbChannelEntity = null;

/**
 * Get full sent history from localStorage cache.
 */
function getHistory() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Save full history to localStorage cache.
 */
function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    console.warn('Could not save sent history to cache');
  }
}

/**
 * Helper to find or create the database channel.
 */
async function findOrCreateDbChannel(client) {
  if (dbChannelEntity) return dbChannelEntity;

  try {
    const dialogs = await client.getDialogs({});
    let dbDialog = dialogs.find(
      (d) => d.title === "Bu Kanalni Ochirmang" && (d.isChannel || d.isGroup)
    );

    if (dbDialog) {
      dbChannelEntity = dbDialog.entity;
      console.log('Database channel found:', dbChannelEntity.id.toString());
      return dbChannelEntity;
    }

    console.log('Creating database channel...');
    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: "Bu Kanalni Ochirmang",
        about: "XABARbot ma'lumotlar bazasi. Iltimos, bu kanalni o'chirmang!",
        megagroup: false,
      })
    );

    const channel = result.chats[0];
    dbChannelEntity = channel;
    console.log('Database channel created:', channel.id.toString());

    // Upload an empty initial database file
    await uploadDbToTelegram(client, channel, {});

    return dbChannelEntity;
  } catch (err) {
    console.error('findOrCreateDbChannel error:', err);
    throw err;
  }
}

/**
 * Helper to upload database to the Telegram channel.
 */
async function uploadDbToTelegram(client, channelEntity, history, isRetry = false) {
  try {
    const jsonStr = JSON.stringify(history, null, 2);
    // Save in js format as requested
    const jsContent = `window.xabarbot_db = ${jsonStr};`;
    const buffer = Buffer.from(jsContent, 'utf-8');

    const file = new CustomFile('database.js', buffer.byteLength, '', buffer);

    console.log('Uploading database.js to Telegram channel...');
    await client.sendFile(channelEntity, {
      file,
      forceDocument: true,
      caption: `Data sync: ${new Date().toLocaleString()}`,
    });
    console.log('Database synced to Telegram channel.');
  } catch (err) {
    console.error('uploadDbToTelegram error:', err);
    dbChannelEntity = null; // Reset cache

    if (!isRetry) {
      console.log('Retrying DB upload by creating a new channel...');
      try {
        const newChannel = await findOrCreateDbChannel(client);
        await uploadDbToTelegram(client, newChannel, history, true);
      } catch (retryErr) {
        console.error('Retry DB upload failed:', retryErr);
      }
    }
  }
}

/**
 * Synchronize history from Telegram channel (overwrites local cache).
 */
export async function syncHistoryFromTelegram() {
  const client = getClient();
  if (!client) return false;

  try {
    const channel = await findOrCreateDbChannel(client);
    if (!channel) return false;

    console.log('Fetching database file from Telegram channel...');
    let messages;
    try {
      messages = await client.getMessages(channel, { limit: 10 });
    } catch (msgErr) {
      console.warn('Could not fetch messages, channel might be deleted. Resetting cache.', msgErr);
      dbChannelEntity = null;
      // Re-run findOrCreateDbChannel to create/find it again
      const newChannel = await findOrCreateDbChannel(client);
      messages = await client.getMessages(newChannel, { limit: 10 });
    }
    
    // Find the latest message containing database.js
    const dbMsg = messages.find(
      (m) => m.media && m.media.document && m.media.document.attributes && m.media.document.attributes.some(
        (a) => a.fileName === 'database.js' || a.filename === 'database.js'
      )
    );

    if (!dbMsg) {
      console.log('No database file found in channel. Storing empty history.');
      saveHistory({});
      return true;
    }

    const buffer = await client.downloadMedia(dbMsg.media);
    if (!buffer) return false;

    const content = buffer.toString('utf-8');

    // Parse the JS file: match the JSON part inside window.xabarbot_db = { ... };
    const match = content.match(/window\.xabarbot_db\s*=\s*([\s\S]+?);/);
    if (match) {
      const history = JSON.parse(match[1]);
      saveHistory(history);
      console.log('Database loaded from Telegram channel successfully.');
      return true;
    }
  } catch (err) {
    console.error('syncHistoryFromTelegram error:', err);
    dbChannelEntity = null; // Reset cache on general error
  }
  return false;
}

/**
 * Sync the local history to the Telegram channel.
 */
export async function syncHistoryToTelegram() {
  const client = getClient();
  if (!client) return;

  try {
    const channel = await findOrCreateDbChannel(client);
    if (!channel) return;

    const history = getHistory();
    await uploadDbToTelegram(client, channel, history);
  } catch (err) {
    console.error('syncHistoryToTelegram error:', err);
  }
}

/**
 * Get sent user IDs for a specific dialog.
 * @param {string|number} dialogId
 * @returns {Set<string>} set of user ID strings
 */
export function getSentUserIds(dialogId) {
  const history = getHistory();
  const key = String(dialogId);
  if (history[key] && history[key].userIds) {
    return new Set(history[key].userIds.map(String));
  }
  return new Set();
}

/**
 * Get the last sent timestamp for a dialog.
 * @param {string|number} dialogId
 * @returns {string|null} formatted date string or null
 */
export function getLastSentTime(dialogId) {
  const history = getHistory();
  const key = String(dialogId);
  if (history[key] && history[key].lastSentAt) {
    return new Date(history[key].lastSentAt).toLocaleString();
  }
  return null;
}

/**
 * Record that messages were sent to specific users in a dialog.
 * @param {string|number} dialogId
 * @param {Array<string|number>} userIds - IDs of users who were successfully sent messages
 */
export function recordSentUsers(dialogId, userIds) {
  const history = getHistory();
  const key = String(dialogId);

  // Merge with existing
  const existing = history[key]?.userIds || [];
  const merged = new Set([...existing.map(String), ...userIds.map(String)]);

  history[key] = {
    userIds: Array.from(merged),
    lastSentAt: Date.now(),
  };

  saveHistory(history);

  // Sync to Telegram channel asynchronously
  syncHistoryToTelegram().catch(console.error);
}

/**
 * Clear sent history for a specific dialog.
 * @param {string|number} dialogId
 */
export function clearSentHistory(dialogId) {
  const history = getHistory();
  const key = String(dialogId);
  delete history[key];
  saveHistory(history);

  // Sync to Telegram channel asynchronously
  syncHistoryToTelegram().catch(console.error);
}

/**
 * Clear all sent history.
 */
export function clearAllHistory() {
  localStorage.removeItem(STORAGE_KEY);
  
  // Sync to Telegram channel asynchronously
  syncHistoryToTelegram().catch(console.error);
}
