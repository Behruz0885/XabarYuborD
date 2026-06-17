import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

async function test(apiId, apiHash, label) {
  console.log(`Testing: ${label} (API ID: ${apiId})...`);
  const session = new StringSession('');
  const client = new TelegramClient(session, Number(apiId), apiHash, {
    connectionRetries: 2,
    // Try both without and with some client info
    deviceModel: 'Telegram Desktop',
    systemVersion: 'Windows 10',
    appVersion: '4.8.4',
  });
  
  try {
    await client.connect();
    // Try requesting a code for a dummy phone number to see if SendCode fails with API_ID_INVALID
    // We don't need a real code, just check if SendCode throws API_ID_INVALID or PHONE_NUMBER_INVALID/FLOOD
    await client.sendCode(
      {
        apiId: Number(apiId),
        apiHash: apiHash,
      },
      '+998900000000'
    );
    console.log(`✅ Success or phone invalid (no API_ID_INVALID) for ${label}\n`);
  } catch (err) {
    console.log(`❌ Failed for ${label}: ${err.message}\n`);
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

async function run() {
  // Test Telegram Desktop
  await test('2040', 'b18441a1ab607e11058b37e2652e13e3', 'Telegram Desktop 2040');

  // Test Webogram / Web K
  await test('2496', '8da85b0d5bfe62527e5b244c209159c3', 'Webogram 2496');

  // Test Android official
  await test('6', 'eb06d4abfb49dc3eeb1aeb98ae0f581e', 'Telegram Android 6');
}

run();
