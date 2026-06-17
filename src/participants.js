import { getClient } from './auth.js';
import { Api } from 'telegram';

/**
 * Fetch participants from a group or channel, excluding admins, bots, and deleted users.
 * @param {object} entity - The Telegram entity (Channel/Chat)
 * @param {function} onProgress - callback(loaded, total) for progress updates
 * @returns {object} { users: Array, adminsCount: number }
 */
export async function fetchParticipants(entity, onProgress) {
  const client = getClient();
  if (!client) throw new Error('Client not connected');

  const participants = [];
  let offset = 0;
  const limit = 200;
  let total = 0;
  let excludedAdminsCount = 0;

  try {
    // For supergroups and channels
    if (entity instanceof Api.Channel) {
      // Fetch administrators/owners
      const adminIds = new Set();
      try {
        const adminsResult = await client.invoke(
          new Api.channels.GetParticipants({
            channel: entity,
            filter: new Api.ChannelParticipantsAdmins(),
            offset: 0,
            limit: 100,
            hash: BigInt(0),
          })
        );
        if (adminsResult.users) {
          for (const u of adminsResult.users) {
            adminIds.add(u.id.toString());
          }
        }
      } catch (adminErr) {
        console.error('Error fetching channel admins:', adminErr);
      }

      // First, get the total count
      const fullChannel = await client.invoke(
        new Api.channels.GetFullChannel({ channel: entity })
      );
      total = fullChannel.fullChat.participantsCount || 0;

      if (onProgress) onProgress(0, total);

      while (true) {
        const result = await client.invoke(
          new Api.channels.GetParticipants({
            channel: entity,
            filter: new Api.ChannelParticipantsRecent(),
            offset,
            limit,
            hash: BigInt(0),
          })
        );

        if (!result.users || result.users.length === 0) break;

        for (const user of result.users) {
          // Skip bots and deleted accounts
          if (user.bot || user.deleted) continue;

          // Skip administrators
          if (adminIds.has(user.id.toString())) {
            excludedAdminsCount++;
            continue;
          }

          participants.push({
            id: user.id,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            username: user.username || null,
            accessHash: user.accessHash,
            entity: user,
          });
        }

        if (onProgress) onProgress(participants.length, total);

        if (result.users.length < limit) break;
        offset += limit;

        // Small delay to avoid FloodWait
        await sleep(300);
      }

      return { users: participants, adminsCount: excludedAdminsCount };
    }
    // For regular groups (Chat)
    else if (entity instanceof Api.Chat) {
      const fullChat = await client.invoke(
        new Api.messages.GetFullChat({ chatId: entity.id })
      );

      const chatParticipants = fullChat.fullChat.participants;
      if (chatParticipants && chatParticipants.participants) {
        total = chatParticipants.participants.length;
        if (onProgress) onProgress(0, total);

        // Identify admins directly
        const adminIds = new Set();
        for (const p of chatParticipants.participants) {
          if (p instanceof Api.ChatParticipantAdmin || p instanceof Api.ChatParticipantCreator) {
            adminIds.add(p.userId.toString());
          }
        }

        for (const p of chatParticipants.participants) {
          // Find user in the users array
          const user = fullChat.users.find(
            (u) => u.id && p.userId && u.id.toString() === p.userId.toString()
          );
          if (user && !user.bot && !user.deleted) {
            // Skip admins
            if (adminIds.has(user.id.toString())) {
              excludedAdminsCount++;
              continue;
            }
            participants.push({
              id: user.id,
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              username: user.username || null,
              accessHash: user.accessHash,
              entity: user,
            });
          }
        }

        if (onProgress) onProgress(participants.length, total);
      }

      return { users: participants, adminsCount: excludedAdminsCount };
    }
  } catch (err) {
    console.error('Error fetching participants:', err);
    throw err;
  }

  return { users: participants, adminsCount: excludedAdminsCount };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
