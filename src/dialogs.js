import { getClient } from './auth.js';
import { Api } from 'telegram';

/**
 * Fetch all dialogs and categorize them.
 * Returns: { channels: [], groups: [], bots: [], private: [] }
 */
export async function fetchDialogs() {
  const client = getClient();
  if (!client) throw new Error('Client not connected');

  const dialogs = await client.getDialogs({ limit: 500 });

  const categorized = {
    channels: [],
    groups: [],
    bots: [],
    private: [],
  };

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity) continue;

    const item = {
      id: dialog.id,
      title: dialog.title || dialog.name || 'Unknown',
      entity: entity,
      unreadCount: dialog.unreadCount || 0,
    };

    // Channel (broadcast)
    if (entity instanceof Api.Channel && entity.broadcast) {
      item.type = 'channel';
      item.memberCount = entity.participantsCount || 0;
      item.username = entity.username || null;
      categorized.channels.push(item);
    }
    // Megagroup / Supergroup
    else if (entity instanceof Api.Channel && entity.megagroup) {
      item.type = 'group';
      item.memberCount = entity.participantsCount || 0;
      item.username = entity.username || null;
      categorized.groups.push(item);
    }
    // Regular group (Chat)
    else if (entity instanceof Api.Chat) {
      item.type = 'group';
      item.memberCount = entity.participantsCount || 0;
      categorized.groups.push(item);
    }
    // Bot
    else if (entity instanceof Api.User && entity.bot) {
      item.type = 'bot';
      item.username = entity.username || null;
      categorized.bots.push(item);
    }
    // Private chat (User)
    else if (entity instanceof Api.User) {
      item.type = 'private';
      item.username = entity.username || null;
      item.firstName = entity.firstName || '';
      item.lastName = entity.lastName || '';
      item.title = `${entity.firstName || ''} ${entity.lastName || ''}`.trim() || 'Unknown';
      categorized.private.push(item);
    }
  }

  return categorized;
}

/**
 * Get avatar color based on entity id.
 */
export function getAvatarColor(id) {
  const colors = [
    '#7c3aed', '#06b6d4', '#10b981', '#f59e0b',
    '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
  ];
  const absId = Math.abs(Number(id) || 0);
  return colors[absId % colors.length];
}

/**
 * Get avatar initials from title.
 */
export function getInitials(title) {
  if (!title) return '?';
  const words = title.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return title.slice(0, 2).toUpperCase();
}
