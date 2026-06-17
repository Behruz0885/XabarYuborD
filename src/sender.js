import { getClient } from './auth.js';

/**
 * Send a message to multiple users (DM) sequentially.
 * Sends messages one-by-one with a delay between each message.
 * If PEER_FLOOD is encountered, sending stops immediately to protect the account.
 * @param {Array} users - Array of user objects with entity
 * @param {string} message - The message text to send
 * @param {object} callbacks
 * @param {function} callbacks.onProgress - (sent, failed, skipped, total)
 * @param {function} callbacks.onLog - (type, text) where type is 'success'|'error'|'warning'|'info'
 * @param {function} callbacks.isCancelled - returns true if sending should stop
 * @param {number} batchSize - messages per batch (default 1)
 * @param {number} batchDelay - delay between batches in ms (default 3000)
 * @param {string} parseMode - 'text' | 'md' | 'html' (default 'text')
 */
export async function sendBulkMessages(users, message, callbacks = {}, batchSize = 1, batchDelay = 3000, parseMode = 'text') {
  const client = getClient();
  if (!client) throw new Error('Client not connected');

  const { onProgress, onLog, onSent, isCancelled } = callbacks;
  const total = users.length;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let stopped = false;

  let parsedLink = null;
  let fromPeer = null;

  if (parseMode === 'forward') {
    parsedLink = parseTelegramMessageLink(message);
    if (!parsedLink) {
      throw new Error('Telegram xabar havolasi noto\'g\'ri kiritilgan. Format: https://t.me/kanal_nomi/123');
    }
    
    if (onLog) onLog('info', `🔍 Xabar havolasi tekshirilmoqda. Chat: ${parsedLink.chatIdentifier}, Xabar ID: ${parsedLink.messageId}...`);
    
    try {
      if (parsedLink.isPrivate) {
        fromPeer = await client.getInputEntity(Number(parsedLink.chatIdentifier));
      } else {
        fromPeer = await client.getInputEntity(parsedLink.chatIdentifier);
      }
      if (onLog) onLog('success', `✅ Havola muvaffaqiyatli tekshirildi.`);
    } catch (err) {
      throw new Error(`Xabar havolasini tekshirishda xatolik: ${err.message}. Iltimos, bu kanal/guruhga a'zo ekanligingizni tekshiring.`);
    }
  }

  const totalBatches = Math.ceil(total / batchSize);
  if (onLog) onLog('info', `📤 Yuborish boshlandi. Jami: ${total} ta foydalanuvchi (${totalBatches} partiya, har biri ${batchSize} tadan ketma-ket)`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    if (stopped) break;

    // Check if cancelled before starting batch
    if (isCancelled && isCancelled()) {
      if (onLog) onLog('warning', `⏹ Yuborish to'xtatildi. ${sent} ta yuborildi.`);
      break;
    }

    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, total);
    const batchNum = batchIndex + 1;
    const batchUsers = users.slice(start, end);

    if (onLog) onLog('info', `📦 Partiya ${batchNum}/${totalBatches} — ${batchUsers.length} ta xabar ketma-ket yuborilmoqda...`);

    // Send messages in this batch SEQUENTIALLY
    for (let i = 0; i < batchUsers.length; i++) {
      if (stopped) break;

      // Check cancel between individual messages
      if (isCancelled && isCancelled()) {
        if (onLog) onLog('warning', `⏹ Yuborish to'xtatildi. ${sent} ta yuborildi.`);
        stopped = true;
        break;
      }

      const user = batchUsers[i];
      const displayName = `${user.firstName} ${user.lastName}`.trim() || user.username || `ID:${user.id}`;

      try {
        if (parseMode === 'forward') {
          await client.forwardMessages(user.entity, {
            messages: [parsedLink.messageId],
            fromPeer: fromPeer,
            dropAuthor: true
          });
        } else {
          const sendOpts = { message };
          if (parseMode === 'html') sendOpts.parseMode = 'html';
          else if (parseMode === 'md') sendOpts.sendOpts = 'md';
          await client.sendMessage(user.entity, sendOpts);
        }
        
        sent++;
        if (onLog) onLog('success', `✅ ${displayName} — yuborildi`);
        if (onSent) onSent(user.id);
        
        // Update progress in real-time
        if (onProgress) onProgress(sent, failed, skipped, total);

        // Add a delay between messages within the batch (except the last message of the batch)
        if (i < batchUsers.length - 1) {
          // Default to at least 2 seconds or a fraction of batchDelay if it's longer
          const intraDelay = Math.max(2000, Math.floor(batchDelay / 2));
          await sleep(intraDelay);
        }
      } catch (err) {
        const errMsg = err.message || String(err);
        
        // Handle FloodWait
        if (errMsg.includes('FloodWait') || errMsg.includes('FLOOD_WAIT')) {
          const waitMatch = errMsg.match(/(\d+)/);
          const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 30;
          if (onLog) onLog('warning', `⏳ FloodWait: ${waitSeconds} soniya kutish kerak...`);
          failed++;
          if (onProgress) onProgress(sent, failed, skipped, total);
          
          // Trigger SpamBot check asynchronously
          sendSpamBotStart(client, onLog);

          // Wait for FloodWait duration
          await sleep(waitSeconds * 1000);
          
          // If waitSeconds is too long, we stop
          if (waitSeconds > 120) {
            stopped = true;
          }
        }
        // Handle PeerFlood — notify SpamBot twice and resume
        else if (errMsg.includes('PeerFlood') || errMsg.includes('PEER_FLOOD')) {
          failed++;
          if (onProgress) onProgress(sent, failed, skipped, total);
          if (onLog) onLog('error', `🚫 PEER_FLOOD cheklovi yuz berdi. @SpamBot faollashtirilmoqda va jarayon davom ettiriladi...`);
          
          // Await SpamBot start queries (takes 4s) before continuing
          await sendSpamBotStart(client, onLog);
        }
        // User privacy restriction
        else if (
          errMsg.includes('UserPrivacyRestricted') ||
          errMsg.includes('USER_PRIVACY_RESTRICTED') ||
          errMsg.includes('InputUserDeactivated') ||
          errMsg.includes('USER_IS_BLOCKED')
        ) {
          skipped++;
          if (onProgress) onProgress(sent, failed, skipped, total);
          if (onLog) onLog('warning', `⚠️ ${displayName} — o'tkazildi (maxfiylik sozlamalari tufayli)`);
        }
        // Other errors
        else {
          failed++;
          if (onProgress) onProgress(sent, failed, skipped, total);
          if (onLog) onLog('error', `❌ ${displayName} — ${errMsg}`);
        }
      }
    }

    // Wait between batches (skip after last batch or if stopped)
    if (!stopped && batchIndex < totalBatches - 1) {
      if (onLog) onLog('info', `⏳ Partiyalararo kutish: ${batchDelay / 1000}s...`);
      await sleep(batchDelay);
    }
  }

  if (onLog) onLog('info', `📊 Yakuniy: ✅ ${sent} yuborildi | ❌ ${failed} xatolik | ⚠️ ${skipped} o'tkazildi`);

  return { sent, failed, skipped, total };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendSpamBotStart(client, onLog) {
  try {
    if (onLog) onLog('warning', `🤖 @SpamBot ga 1-marta /start yuborilmoqda...`);
    await client.sendMessage('SpamBot', { message: '/start' });
    
    // Wait 4 seconds as requested
    await sleep(4000);
    
    if (onLog) onLog('warning', `🤖 @SpamBot ga 2-marta /start yuborilmoqda... (4s keyin)`);
    await client.sendMessage('SpamBot', { message: '/start' });
    
    if (onLog) onLog('success', `✅ @SpamBot ga xabarlar yuborildi.`);
  } catch (err) {
    if (onLog) onLog('error', `⚠️ @SpamBot ga yozishda xatolik: ${err.message}`);
  }
}

function parseTelegramMessageLink(url) {
  const cleanUrl = url.trim();
  
  // 1. Check for standard web links: t.me/username/123 or t.me/c/1234567/123
  const webRegex = /(?:t\.me|telegram\.me)\/(?:c\/(\d+)|([a-zA-Z0-9_]{5,}))\/(\d+)/i;
  const webMatch = cleanUrl.match(webRegex);
  
  if (webMatch) {
    const isPrivate = !!webMatch[1];
    const chatIdentifier = isPrivate ? webMatch[1] : webMatch[2];
    const messageId = parseInt(webMatch[3], 10);
    
    return {
      isPrivate,
      chatIdentifier: isPrivate ? `-100${chatIdentifier}` : chatIdentifier,
      messageId
    };
  }
  
  // 2. Check for deep links: tg://resolve?domain=username&post=123
  const tgRegex = /tg:\/\/resolve\?(?:domain|path)=([a-zA-Z0-9_]{5,})&post=(\d+)/i;
  const tgMatch = cleanUrl.match(tgRegex);
  if (tgMatch) {
    return {
      isPrivate: false,
      chatIdentifier: tgMatch[1],
      messageId: parseInt(tgMatch[2], 10)
    };
  }
  
  return null;
}
