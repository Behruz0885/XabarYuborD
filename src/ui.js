import { loginToTelegram, hasSavedSession, reconnectFromSession, getCurrentUser, logout } from './auth.js';
import { fetchDialogs, getAvatarColor, getInitials } from './dialogs.js';
import { fetchParticipants } from './participants.js';
import { sendBulkMessages } from './sender.js';
import { getSentUserIds, getLastSentTime, recordSentUsers, clearSentHistory, syncHistoryFromTelegram } from './history.js';

// ============ State ============
const state = {
  step: 1, // 1=login, 2=dialogs, 3=send
  connected: false,
  user: null,
  dialogs: null,
  activeTab: 'groups',
  selectedDialog: null,
  participants: [],
  loadingParticipants: false,
  sending: false,
  sendCancelled: false,
  searchQuery: '',
  parseMode: 'html',
  filteredAdminsCount: 0,
};

// ============ Toast System ============
export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ============ Render Steps Bar ============
function renderSteps() {
  const steps = [
    { num: 1, label: 'Ulanish' },
    { num: 2, label: 'Tanlash' },
    { num: 3, label: 'Yuborish' },
  ];

  return `
    <div class="steps-bar">
      ${steps
        .map((s, i) => {
          const isActive = s.num === state.step;
          const isDone = s.num < state.step;
          return `
          <div class="step-item">
            <div class="step-circle ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}">${isDone ? '✓' : s.num}</div>
            <span class="step-label ${isActive ? 'active' : ''}">${s.label}</span>
          </div>
          ${i < steps.length - 1 ? `<div class="step-line ${isDone ? 'done' : ''}"></div>` : ''}
        `;
        })
        .join('')}
    </div>
  `;
}

// ============ Render Header ============
function renderHeader() {
  const userName = state.user ? `${state.user.firstName || ''} ${state.user.lastName || ''}`.trim() : '';
  return `
    <div class="header">
      <div class="header-logo">
        <div class="logo-icon">📨</div>
        <h1>XABARbot</h1>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="header-status">
          <div class="status-dot ${state.connected ? 'connected' : ''}"></div>
          <span>${state.connected ? (userName || 'Ulangan') : 'Ulanmagan'}</span>
        </div>
        ${state.connected ? `<button class="btn-disconnect" id="btn-logout">Chiqish</button>` : ''}
      </div>
    </div>
  `;
}

// ============ Page 1: Login ============
function renderLoginPage() {
  return `
    <div class="main-container">
      <div class="glass-card login-card">
        <h2>🔐 Telegramga ulanish</h2>
        <p class="subtitle">Tizimga ulanish uchun telefon raqamingizni kiriting.</p>

        <div class="form-group">
          <label for="input-phone">Telefon raqam</label>
          <input type="text" id="input-phone" placeholder="Masalan: +998901234567" autocomplete="off" />
        </div>

        <details class="advanced-settings-details">
          <summary>
            <span>⚙️ Kengaytirilgan sozlamalar</span>
          </summary>
          <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 16px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label for="input-api-id">API ID (ixtiyoriy)</label>
              <input type="text" id="input-api-id" placeholder="Masalan: 12345678" autocomplete="off" />
            </div>

            <div class="form-group" style="margin-bottom: 0;">
              <label for="input-api-hash">API Hash (ixtiyoriy)</label>
              <input type="text" id="input-api-hash" placeholder="Masalan: a1b2c3d4e5f6..." autocomplete="off" />
            </div>
            
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0; line-height: 1.4;">
              Agar bo'sh qoldirilsa, standart Telegram Desktop ma'lumotlari ishlatiladi.
            </p>
          </div>
        </details>

        <button class="btn btn-primary btn-full" id="btn-connect">
          <span>🚀 Ulanish</span>
        </button>
      </div>
    </div>
  `;
}

// ============ Page 2: Dialogs ============
function renderDialogsPage() {
  if (!state.dialogs) {
    return `
      <div class="main-container">
        <div class="glass-card" style="text-align: center;">
          <div class="spinner spinner-large"></div>
          <p style="color: var(--text-secondary); margin-top: 16px;">Dialoglar yuklanmoqda...</p>
        </div>
      </div>
    `;
  }

  const tabs = [
    { key: 'groups', icon: '👥', label: 'Guruhlar', count: state.dialogs.groups.length },
    { key: 'channels', icon: '📢', label: 'Kanallar', count: state.dialogs.channels.length },
    { key: 'bots', icon: '🤖', label: 'Botlar', count: state.dialogs.bots.length },
    { key: 'private', icon: '💬', label: 'Shaxsiy', count: state.dialogs.private.length },
  ];

  const currentList = state.dialogs[state.activeTab] || [];
  const filtered = state.searchQuery
    ? currentList.filter((d) => d.title.toLowerCase().includes(state.searchQuery.toLowerCase()))
    : currentList;

  return `
    <div class="main-container">
      <div class="glass-card">
        <h2 style="font-size: 1.3rem; margin-bottom: 16px;">📋 Guruh yoki kanal tanlang</h2>

        <div class="tabs">
          ${tabs
            .map(
              (t) => `
            <button class="tab-btn ${state.activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">
              ${t.icon} ${t.label}
              <span class="tab-count">${t.count}</span>
            </button>
          `
            )
            .join('')}
        </div>

        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="search-dialog" placeholder="Qidirish..." value="${state.searchQuery}" />
        </div>

        <div class="dialog-list" id="dialog-list">
          ${
            filtered.length === 0
              ? `<div class="empty-state">
                  <div class="empty-icon">📭</div>
                  <p>Bu kategoriyada hech narsa topilmadi</p>
                </div>`
              : filtered
                  .map(
                    (d) => `
                <div class="dialog-item ${state.selectedDialog && state.selectedDialog.id.toString() === d.id.toString() ? 'selected' : ''}"
                     data-dialog-id="${d.id}">
                  <div class="dialog-avatar" style="background: ${getAvatarColor(d.id)}">
                    ${getInitials(d.title)}
                  </div>
                  <div class="dialog-info">
                    <div class="dialog-name">${escapeHtml(d.title)}</div>
                    <div class="dialog-meta">
                      ${d.memberCount ? `${d.memberCount} a'zo` : ''}
                      ${d.username ? ` · @${d.username}` : ''}
                    </div>
                  </div>
                  <div class="dialog-check"></div>
                </div>
              `
                  )
                  .join('')
          }
        </div>

        ${
          state.selectedDialog
            ? `
          <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
            <button class="btn btn-primary" id="btn-next-step">
              Davom etish →
            </button>
          </div>
        `
            : ''
        }
      </div>
    </div>
  `;
}

// ============ Page 3: Send Messages ============
function renderSendPage() {
  return `
    <div class="main-container">
      <div class="glass-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <h2 style="font-size: 1.3rem;">📤 Xabar yuborish</h2>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 4px;">
              ${escapeHtml(state.selectedDialog?.title || '')}
            </p>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-back">← Orqaga</button>
        </div>

        <!-- Participants Section -->
        ${(() => {
          const sentIds = state.selectedDialog ? getSentUserIds(state.selectedDialog.id) : new Set();
          const lastTime = state.selectedDialog ? getLastSentTime(state.selectedDialog.id) : null;
          const sentCount = state.participants.filter(p => sentIds.has(String(p.id))).length;
          const newCount = state.participants.length - sentCount;
          return `
        <div class="participants-header">
          <h3>👤 A'zolar</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${!state.loadingParticipants && state.filteredAdminsCount > 0 ? `
              <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: var(--accent-red); font-size: 0.72rem; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(239, 68, 68, 0.25); font-weight: 500;">
                🛡️ ${state.filteredAdminsCount} ta admin filtrlandi
              </span>
            ` : ''}
            <span class="participants-count" id="participant-count">
              ${state.loadingParticipants ? 'Yuklanmoqda...' : `${state.participants.length} ta`}
            </span>
          </div>
        </div>

        ${sentCount > 0 ? `
          <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div>
              <span style="color: var(--accent-orange); font-size: 0.9rem; font-weight: 500;">📋 ${sentCount} ta a'zoga avval xabar yuborilgan</span>
              ${lastTime ? `<span style="color: var(--text-muted); font-size: 0.78rem; display: block; margin-top: 2px;">Oxirgi: ${lastTime}</span>` : ''}
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span style="font-size: 0.82rem; color: var(--accent-green);">🆕 ${newCount} ta yangi</span>
              <button class="btn btn-secondary btn-sm" id="btn-clear-history">🗑 Tarixni tozalash</button>
            </div>
          </div>
        ` : ''}
        `;
        })()}

        ${
          state.loadingParticipants
            ? `
          <div style="text-align: center; padding: 20px;">
            <div class="spinner spinner-large"></div>
            <p style="color: var(--text-secondary); margin-top: 12px;" id="participants-progress">A'zolar yuklanmoqda...</p>
          </div>
        `
            : `
          <div style="max-height: 200px; overflow-y: auto; margin-bottom: 20px;">
            ${(() => {
              const sentIds = state.selectedDialog ? getSentUserIds(state.selectedDialog.id) : new Set();
              return state.participants
                .slice(0, 50)
                .map(
                  (p) => {
                    const wasSent = sentIds.has(String(p.id));
                    return `
                <div class="participant-item" style="${wasSent ? 'opacity: 0.65;' : ''}">
                  <div class="participant-avatar" style="background: ${wasSent ? 'var(--accent-orange)' : getAvatarColor(p.id)}">
                    ${wasSent ? '✓' : getInitials(`${p.firstName} ${p.lastName}`)}
                  </div>
                  <div style="flex: 1; min-width: 0;">
                    <div class="participant-name">${escapeHtml(`${p.firstName} ${p.lastName}`.trim() || 'Noma\'lum')}</div>
                    ${p.username ? `<div class="participant-username">@${escapeHtml(p.username)}</div>` : ''}
                  </div>
                  ${wasSent ? '<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 10px; background: rgba(245, 158, 11, 0.15); color: var(--accent-orange); font-weight: 500; white-space: nowrap;">yuborilgan</span>' : '<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 10px; background: rgba(16, 185, 129, 0.15); color: var(--accent-green); font-weight: 500; white-space: nowrap;">yangi</span>'}
                </div>
              `;
                  }
                )
                .join('');
            })()}
            ${state.participants.length > 50 ? `<p style="color: var(--text-muted); text-align: center; padding: 8px;">va yana ${state.participants.length - 50} ta...</p>` : ''}
          </div>

          <!-- Speed Settings -->
          <div style="background: rgba(124, 58, 237, 0.08); border: 1px solid rgba(124, 58, 237, 0.2); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
            <h3 style="font-size: 0.95rem; margin-bottom: 12px;">⚡ Tezlik sozlamalari</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label for="input-batch-size">Partiya hajmi</label>
                <input type="number" id="input-batch-size" value="1" min="1" max="50" ${state.sending ? 'disabled' : ''} />
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label for="input-batch-delay">Kutish (soniya)</label>
                <input type="number" id="input-batch-delay" value="4" min="1" max="60" step="0.5" ${state.sending ? 'disabled' : ''} />
              </div>
            </div>
            <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 8px;">⚠️ Ban xavfini kamaytirish uchun xabarlarni ketma-ket, kamida 3-5 soniya kutish bilan yuborish tavsiya etiladi (Partiya hajmi: 1, Kutish: 4-5s).</p>
          </div>

          <!-- Composer -->
          <div class="composer-section">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
              <h3>${state.parseMode === 'forward' ? '🔗 Xabar havolasi (Forward)' : '✏️ Xabar matni'}</h3>
              <div style="display: flex; align-items: center; gap: 8px;">
                <label for="select-parse-mode" style="font-size: 0.82rem; color: var(--text-secondary);">Format:</label>
                <select id="select-parse-mode" style="padding: 5px 10px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font); font-size: 0.85rem; outline: none; cursor: pointer;" ${state.sending ? 'disabled' : ''}>
                  <option value="html" ${state.parseMode === 'html' ? 'selected' : ''}>HTML (premium emoji ✅)</option>
                  <option value="md" ${state.parseMode === 'md' ? 'selected' : ''}>Markdown</option>
                  <option value="text" ${state.parseMode === 'text' ? 'selected' : ''}>Oddiy matn</option>
                  <option value="forward" ${state.parseMode === 'forward' ? 'selected' : ''}>PremiumStikerlar bilan (Forward 🚀)</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-top: 0;">
              <textarea id="message-text" placeholder="${state.parseMode === 'forward' ? 'Telegram xabar havolasini kiriting (masalan: https://t.me/kanal_nomi/123). Har qanday stiker yoki premium xabar forward qilinadi.' : 'Xabaringizni yozing... HTML rejimda premium emoji ishlaydi!'}" ${state.sending ? 'disabled' : ''}></textarea>
            </div>
            
            ${state.parseMode === 'forward' ? '' : `
            <details style="margin-bottom: 14px; font-size: 0.82rem; color: var(--text-muted);">
              <summary style="cursor: pointer; color: var(--accent-cyan); font-weight: 500;">📝 Format qo'llanma (bosing)</summary>
              <div style="margin-top: 8px; padding: 12px; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); line-height: 1.8;">
                <strong style="color: var(--text-secondary);">HTML:</strong><br>
                <code style="color: var(--accent-cyan);">&lt;b&gt;qalin&lt;/b&gt;</code> — qalin matn<br>
                <code style="color: var(--accent-cyan);">&lt;i&gt;kursiv&lt;/i&gt;</code> — kursiv matn<br>
                <code style="color: var(--accent-cyan);">&lt;u&gt;tagchiziq&lt;/u&gt;</code> — tagchiziqli<br>
                <code style="color: var(--accent-cyan);">&lt;a href="link"&gt;matn&lt;/a&gt;</code> — havola<br>
                <code style="color: var(--accent-orange);">&lt;tg-emoji emoji-id="5368324170671202286"&gt;👍&lt;/tg-emoji&gt;</code> — <strong>Premium emoji</strong><br>
                <span style="color: var(--accent-green); font-size: 0.78rem;">💡 Premium emoji ID ni Telegram botdan olishingiz mumkin: @GetCustomEmojiBot</span><br>
                <br>
                <strong style="color: var(--text-secondary);">Markdown:</strong><br>
                <code style="color: var(--accent-cyan);">**qalin**</code> — qalin | <code style="color: var(--accent-cyan);">__kursiv__</code> — kursiv
              </div>
            </details>
            `}
            <div class="composer-actions">
              <button class="btn btn-primary btn-full" id="btn-send" ${state.sending ? 'disabled' : ''}>
                ${state.sending ? '<div class="spinner"></div> Yuborilmoqda...' : '📨 Yuborish'}
              </button>
              ${state.sending ? '<button class="btn btn-danger" id="btn-cancel-send">⏹ To\'xtatish</button>' : ''}
            </div>
          </div>

          <!-- Progress -->
          <div class="progress-section" id="progress-section" style="display: none;">
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-stats" id="progress-stats"></div>
          </div>

          <!-- Log -->
          <div class="send-log" id="send-log" style="display: none;"></div>
        `
        }
      </div>
    </div>
  `;
}

// ============ Modal: SMS Code ============
function showCodeModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <h3>📱 SMS Kod</h3>
        <p>Telegram'dan kelgan kodni kiriting</p>
        <div class="form-group">
          <input type="text" id="sms-code-input" placeholder="12345" autocomplete="one-time-code"
                 style="text-align: center; font-size: 1.5rem; letter-spacing: 8px; font-weight: 700;" />
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
          <button class="btn btn-secondary btn-full" id="btn-cancel-code">Bekor qilish</button>
          <button class="btn btn-primary btn-full" id="btn-submit-code">Tasdiqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#sms-code-input');
    input.focus();

    const submit = () => {
      const code = input.value.trim();
      if (code) {
        overlay.remove();
        resolve(code);
      }
    };

    overlay.querySelector('#btn-submit-code').addEventListener('click', submit);
    overlay.querySelector('#btn-cancel-code').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  });
}

// ============ Modal: 2FA Password ============
function showPasswordModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <h3>🔑 2FA Parol</h3>
        <p>Ikki bosqichli parolingizni kiriting</p>
        <div class="form-group">
          <input type="password" id="password-input" placeholder="Parol" />
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
          <button class="btn btn-secondary btn-full" id="btn-cancel-password">Bekor qilish</button>
          <button class="btn btn-primary btn-full" id="btn-submit-password">Tasdiqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#password-input');
    input.focus();

    const submit = () => {
      const pass = input.value;
      if (pass) {
        overlay.remove();
        resolve(pass);
      }
    };

    overlay.querySelector('#btn-submit-password').addEventListener('click', submit);
    overlay.querySelector('#btn-cancel-password').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  });
}

// ============ Modal: Resend Confirmation ============
function showResendModal(alreadySentCount, newCount) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" style="max-width: 460px;">
        <h3>⚠️ Qayta yuborish</h3>
        <p style="margin-bottom: 16px;">
          <strong style="color: var(--accent-orange);">${alreadySentCount}</strong> ta a'zoga avval xabar yuborilgan.
          ${newCount > 0 ? `<strong style="color: var(--accent-green);">${newCount}</strong> ta yangi a'zo bor.` : 'Yangi a\'zolar yo\'q.'}
        </p>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${newCount > 0 ? `
            <button class="btn btn-primary btn-full" id="btn-resend-new">
              🆕 Faqat yangilariga yuborish (${newCount} ta)
            </button>
          ` : ''}
          <button class="btn btn-secondary btn-full" id="btn-resend-all" style="border-color: rgba(245, 158, 11, 0.3); color: var(--accent-orange);">
            🔄 Barchasiga qayta yuborish (${alreadySentCount + newCount} ta)
          </button>
          <button class="btn btn-secondary btn-full" id="btn-resend-cancel">
            ❌ Bekor qilish
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const btnNew = overlay.querySelector('#btn-resend-new');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        overlay.remove();
        resolve('new_only');
      });
    }

    overlay.querySelector('#btn-resend-all').addEventListener('click', () => {
      overlay.remove();
      resolve('send_all');
    });

    overlay.querySelector('#btn-resend-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve('cancel');
    });
  });
}

// ============ Modal: Private Chat Confirmation ============
function showPrivateChatModal(inPrivateCount, notInPrivateCount) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" style="max-width: 480px;">
        <h3>💬 Shaxsiy chatlar filtri</h3>
        <p style="margin-bottom: 16px; font-size: 15px; line-height: 1.5;">
          Tanlangan a'zolardan <strong style="color: var(--accent-blue);">${inPrivateCount}</strong> tasi bilan avvaldan shaxsiy chatingiz (DM) bor. 
          ${notInPrivateCount > 0 ? `<strong style="color: var(--accent-orange);">${notInPrivateCount}</strong> tasi bilan esa hali shaxsiy chat mavjud emas.` : 'Barchasi bilan shaxsiy chatingiz bor.'}
        </p>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px; line-height: 1.4;">
          ⚠️ <strong>Eslatma:</strong> Telegramda avvaldan yozishmalar mavjud bo'lmagan foydalanuvchilarga ommaviy xabar yuborish tezda bloklanishga (spam/limit) olib kelishi mumkin. Xavfsizroq bo'lishi uchun faqat shaxsiy chati borlarga yuborishni tanlashingiz mumkin.
        </p>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${inPrivateCount > 0 && notInPrivateCount > 0 ? `
            <button class="btn btn-primary btn-full" id="btn-dm-only-private" style="background: linear-gradient(135deg, #2563eb, #1d4ed8);">
              🛡️ Faqat shaxsiy chati borlarga yuborish (${inPrivateCount} ta)
            </button>
          ` : ''}
          ${notInPrivateCount > 0 ? `
            <button class="btn btn-secondary btn-full" id="btn-dm-skip-private" style="border-color: rgba(245, 158, 11, 0.3); color: var(--accent-orange);">
              🚫 Shaxsiy chati borlarni o'tkazib yuborish (${notInPrivateCount} ta)
            </button>
          ` : ''}
          <button class="btn btn-secondary btn-full" id="btn-dm-all">
            🚀 Barchasiga yuborish (${inPrivateCount + notInPrivateCount} ta)
          </button>
          <button class="btn btn-secondary btn-full" id="btn-dm-cancel" style="border-color: rgba(239, 68, 68, 0.3); color: var(--accent-red);">
            ❌ Bekor qilish
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const btnOnlyPrivate = overlay.querySelector('#btn-dm-only-private');
    if (btnOnlyPrivate) {
      btnOnlyPrivate.addEventListener('click', () => {
        overlay.remove();
        resolve('only_private');
      });
    }

    const btnSkipPrivate = overlay.querySelector('#btn-dm-skip-private');
    if (btnSkipPrivate) {
      btnSkipPrivate.addEventListener('click', () => {
        overlay.remove();
        resolve('skip_private');
      });
    }

    overlay.querySelector('#btn-dm-all').addEventListener('click', () => {
      overlay.remove();
      resolve('send_all');
    });

    overlay.querySelector('#btn-dm-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve('cancel');
    });
  });
}

// ============ HTML Escape ============
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ============ Main Render ============
export function render() {
  const app = document.getElementById('app');

  let content = renderHeader();
  content += renderSteps();

  switch (state.step) {
    case 1:
      content += renderLoginPage();
      break;
    case 2:
      content += renderDialogsPage();
      break;
    case 3:
      content += renderSendPage();
      break;
  }

  app.innerHTML = content;
  attachEventListeners();
}

// ============ Event Listeners ============
function attachEventListeners() {
  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await logout();
      state.connected = false;
      state.user = null;
      state.step = 1;
      state.dialogs = null;
      state.selectedDialog = null;
      state.participants = [];
      render();
      showToast('Akkauntdan chiqildi', 'info');
    });
  }

  // Step 1: Connect
  const btnConnect = document.getElementById('btn-connect');
  if (btnConnect) {
    btnConnect.addEventListener('click', handleConnect);
  }

  // Step 2: Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      state.searchQuery = '';
      render();
    });
  });

  // Step 2: Search
  const searchInput = document.getElementById('search-dialog');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      // Re-render just the list to avoid losing focus
      renderDialogListOnly();
    });
  }

  // Step 2: Select dialog
  document.querySelectorAll('.dialog-item').forEach((item) => {
    item.addEventListener('click', () => {
      const dialogId = item.dataset.dialogId;
      const allDialogs = [
        ...state.dialogs.channels,
        ...state.dialogs.groups,
        ...state.dialogs.bots,
        ...state.dialogs.private,
      ];
      const dialog = allDialogs.find((d) => d.id.toString() === dialogId);
      if (dialog) {
        if (state.selectedDialog && state.selectedDialog.id.toString() === dialogId) {
          state.selectedDialog = null; // Unselect toggle
        } else {
          state.selectedDialog = dialog;
        }
        render();
      }
    });
  });

  // Step 2: Next
  const btnNext = document.getElementById('btn-next-step');
  if (btnNext) {
    btnNext.addEventListener('click', async () => {
      if (!state.selectedDialog) {
        showToast('Iltimos, avval guruh yoki kanalni tanlang', 'error');
        return;
      }
      state.step = 3;
      state.loadingParticipants = true;
      state.participants = [];
      render();

      const currentTargetDialogId = state.selectedDialog.id;

      try {
        const loadedList = await fetchParticipants(state.selectedDialog.entity, (loaded, total) => {
          if (state.step !== 3 || !state.selectedDialog || state.selectedDialog.id !== currentTargetDialogId) {
            return;
          }
          const progressEl = document.getElementById('participants-progress');
          if (progressEl) {
            progressEl.textContent = `A'zolar yuklanmoqda... ${loaded}/${total}`;
          }
        });

        if (state.step !== 3 || !state.selectedDialog || state.selectedDialog.id !== currentTargetDialogId) {
          return;
        }

        state.participants = loadedList.users;
        state.filteredAdminsCount = loadedList.adminsCount;
        state.loadingParticipants = false;
        render();
        
        let msg = `${state.participants.length} ta a'zo topildi`;
        if (state.filteredAdminsCount > 0) {
          msg += ` (${state.filteredAdminsCount} ta admin filtrlandi)`;
        }
        showToast(msg, 'success');
      } catch (err) {
        if (state.step !== 3 || !state.selectedDialog || state.selectedDialog.id !== currentTargetDialogId) {
          return;
        }
        state.loadingParticipants = false;
        render();
        showToast(`Xatolik: ${err.message}`, 'error');
      }
    });
  }

  // Step 3: Back
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      if (state.sending) {
        state.sendCancelled = true;
        state.sending = false;
      }
      state.step = 2;
      state.participants = [];
      render();
    });
  }

  // Step 3: Send
  const btnSend = document.getElementById('btn-send');
  if (btnSend) {
    btnSend.addEventListener('click', handleSend);
  }

  // Step 3: Parse Mode change
  const selectParseMode = document.getElementById('select-parse-mode');
  if (selectParseMode) {
    selectParseMode.addEventListener('change', (e) => {
      state.parseMode = e.target.value;
      const currentText = document.getElementById('message-text')?.value || '';
      render();
      const newTextArea = document.getElementById('message-text');
      if (newTextArea) newTextArea.value = currentText;
    });
  }

  // Step 3: Cancel
  const btnCancel = document.getElementById('btn-cancel-send');
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      state.sendCancelled = true;
    });
  }

  // Step 3: Clear history
  const btnClearHistory = document.getElementById('btn-clear-history');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      if (state.selectedDialog) {
        clearSentHistory(state.selectedDialog.id);
        render();
        showToast('Tarix tozalandi', 'info');
      }
    });
  }
}

// ============ Render only dialog list (for search) ============
function renderDialogListOnly() {
  const listEl = document.getElementById('dialog-list');
  if (!listEl || !state.dialogs) return;

  const currentList = state.dialogs[state.activeTab] || [];
  const filtered = state.searchQuery
    ? currentList.filter((d) => d.title.toLowerCase().includes(state.searchQuery.toLowerCase()))
    : currentList;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Bu kategoriyada hech narsa topilmadi</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (d) => `
    <div class="dialog-item ${state.selectedDialog && state.selectedDialog.id.toString() === d.id.toString() ? 'selected' : ''}"
         data-dialog-id="${d.id}">
      <div class="dialog-avatar" style="background: ${getAvatarColor(d.id)}">
        ${getInitials(d.title)}
      </div>
      <div class="dialog-info">
        <div class="dialog-name">${escapeHtml(d.title)}</div>
        <div class="dialog-meta">
          ${d.memberCount ? `${d.memberCount} a'zo` : ''}
          ${d.username ? ` · @${d.username}` : ''}
        </div>
      </div>
      <div class="dialog-check"></div>
    </div>
  `
    )
    .join('');

  // Re-attach click listeners for dialog items
  listEl.querySelectorAll('.dialog-item').forEach((item) => {
    item.addEventListener('click', () => {
      const dialogId = item.dataset.dialogId;
      const allDialogs = [
        ...state.dialogs.channels,
        ...state.dialogs.groups,
        ...state.dialogs.bots,
        ...state.dialogs.private,
      ];
      const dialog = allDialogs.find((d) => d.id.toString() === dialogId);
      if (dialog) {
        if (state.selectedDialog && state.selectedDialog.id.toString() === dialogId) {
          state.selectedDialog = null; // Unselect toggle
        } else {
          state.selectedDialog = dialog;
        }
        render();
      }
    });
  });
}

// ============ Handle Connect ============
async function handleConnect() {
  const customApiId = document.getElementById('input-api-id')?.value?.trim();
  const customApiHash = document.getElementById('input-api-hash')?.value?.trim();
  const phone = document.getElementById('input-phone')?.value?.trim();

  if (!phone) {
    showToast('Telefon raqamni kiriting', 'error');
    return;
  }

  // Standart Telegram Desktop API ma'lumotlari
  const apiId = customApiId || '2040';
  const apiHash = customApiHash || 'b18441a1ab607e11058b37e2652e13e3';

  // Agar bittasi kiritilib, ikkinchisi kiritilmagan bo'lsa
  if ((customApiId && !customApiHash) || (!customApiId && customApiHash)) {
    showToast('Kengaytirilgan sozlamalarda API ID va API Hash ikkalasini ham kiriting yoki ikkalasini ham bo\'sh qoldiring', 'warning');
    return;
  }

  const btn = document.getElementById('btn-connect');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Ulanmoqda...';

  try {
    await loginToTelegram({
      apiId,
      apiHash,
      phoneNumber: phone,
      onCodeRequest: showCodeModal,
      onPasswordRequest: showPasswordModal,
      onError: (err) => showToast(`Xatolik: ${err.message}`, 'error'),
    });

    state.connected = true;
    state.user = await getCurrentUser();
    state.step = 2;
    render();
    showToast('Muvaffaqiyatli ulandi! ✅', 'success');

    // Sync history database from Telegram channel
    showToast("Ma'lumotlar bazasi yuklanmoqda... ⏳", 'info');
    try {
      await syncHistoryFromTelegram();
      showToast("Ma'lumotlar bazasi sinxronizatsiya qilindi! ✅", 'success');
    } catch (dbErr) {
      showToast(`Bazani yuklashda xatolik: ${dbErr.message}`, 'warning');
    }

    // Load dialogs
    loadDialogs();
  } catch (err) {
    showToast(`Ulanish xatosi: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span>🚀 Ulanish</span>';
  }
}

// ============ Load Dialogs ============
async function loadDialogs() {
  try {
    state.dialogs = await fetchDialogs();
    render();
  } catch (err) {
    showToast(`Dialoglarni yuklashda xatolik: ${err.message}`, 'error');
  }
}

// ============ Handle Send ============
async function handleSend() {
  const messageText = document.getElementById('message-text')?.value?.trim();
  if (!messageText) {
    showToast(state.parseMode === 'forward' ? 'Telegram xabar havolasini kiriting' : 'Xabar matnini kiriting', 'error');
    return;
  }

  if (state.participants.length === 0) {
    showToast('A\'zolar ro\'yxati bo\'sh', 'error');
    return;
  }

  // Read speed settings
  const batchSize = parseInt(document.getElementById('input-batch-size')?.value) || 1;
  const batchDelay = (parseFloat(document.getElementById('input-batch-delay')?.value) || 4) * 1000;
  const parseMode = document.getElementById('select-parse-mode')?.value || 'html';

  // Check for previously sent users
  const dialogId = state.selectedDialog?.id;
  const sentIds = dialogId ? getSentUserIds(dialogId) : new Set();
  const alreadySent = state.participants.filter(p => sentIds.has(String(p.id)));
  const newOnly = state.participants.filter(p => !sentIds.has(String(p.id)));

  let usersToSend = state.participants;

  if (alreadySent.length > 0) {
    const choice = await showResendModal(alreadySent.length, newOnly.length);
    if (choice === 'cancel') return;
    if (choice === 'new_only') {
      usersToSend = newOnly;
      if (usersToSend.length === 0) {
        showToast('Yangi a\'zolar yo\'q, barchasiga avval yuborilgan', 'info');
        return;
      }
    }
  }

  // Check for users already in private chats
  if (state.dialogs && state.dialogs.private && state.dialogs.private.length > 0) {
    const privateChatIds = new Set(state.dialogs.private.map(d => String(d.id)));
    const inPrivate = usersToSend.filter(p => privateChatIds.has(String(p.id)));
    const notInPrivate = usersToSend.filter(p => !privateChatIds.has(String(p.id)));

    if (inPrivate.length > 0) {
      const dmChoice = await showPrivateChatModal(inPrivate.length, notInPrivate.length);
      if (dmChoice === 'cancel') return;
      if (dmChoice === 'skip_private') {
        usersToSend = notInPrivate;
        if (usersToSend.length === 0) {
          showToast('Barchasi shaxsiy chatda, yuborish bekor qilindi', 'info');
          return;
        }
      } else if (dmChoice === 'only_private') {
        usersToSend = inPrivate;
        if (usersToSend.length === 0) {
          showToast('Shaxsiy chatlar topilmadi, yuborish bekor qilindi', 'info');
          return;
        }
      }
    }
  }

  state.parseMode = parseMode;
  state.sending = true;
  state.sendCancelled = false;
  render();

  // Restore message text and settings after re-render
  const textArea = document.getElementById('message-text');
  if (textArea) textArea.value = messageText;
  const bsInput = document.getElementById('input-batch-size');
  if (bsInput) bsInput.value = batchSize;
  const bdInput = document.getElementById('input-batch-delay');
  if (bdInput) bdInput.value = batchDelay / 1000;
  const pmSelect = document.getElementById('select-parse-mode');
  if (pmSelect) pmSelect.value = parseMode;

  // Show progress section and log
  const progressSection = document.getElementById('progress-section');
  const logSection = document.getElementById('send-log');
  if (progressSection) progressSection.style.display = 'block';
  if (logSection) logSection.style.display = 'block';

  // Track successfully sent user IDs
  const successfullySentIds = [];

  try {
    await sendBulkMessages(
      usersToSend,
      messageText,
      {
        onProgress: (sent, failed, skipped, total) => {
          const percent = Math.round(((sent + failed + skipped) / total) * 100);
          const fill = document.getElementById('progress-fill');
          if (fill) fill.style.width = `${percent}%`;

          const stats = document.getElementById('progress-stats');
          if (stats) {
            stats.innerHTML = `
              <div class="stat-item"><div class="stat-dot success"></div> ${sent} yuborildi</div>
              <div class="stat-item"><div class="stat-dot error"></div> ${failed} xatolik</div>
              <div class="stat-item"><div class="stat-dot skipped"></div> ${skipped} o'tkazildi</div>
              <div class="stat-item"><div class="stat-dot pending"></div> ${total - sent - failed - skipped} kutmoqda</div>
            `;
          }
        },
        onLog: (type, text) => {
          const logEl = document.getElementById('send-log');
          if (logEl) {
            const entry = document.createElement('div');
            entry.className = `log-entry ${type}`;
            entry.innerHTML = `<span>${new Date().toLocaleTimeString()}</span> <span>${escapeHtml(text)}</span>`;
            logEl.appendChild(entry);
            logEl.scrollTop = logEl.scrollHeight;
          }
        },
        onSent: (userId) => {
          successfullySentIds.push(userId);
        },
        isCancelled: () => state.sendCancelled,
      },
      batchSize,
      batchDelay,
      parseMode
    );
  } catch (err) {
    showToast(`Yuborishda xatolik: ${err.message}`, 'error');
  }

  // Record sent users in history
  if (dialogId && successfullySentIds.length > 0) {
    recordSentUsers(dialogId, successfullySentIds);
  }

  state.sending = false;
  // Don't re-render to preserve log/progress
  const btnSend = document.getElementById('btn-send');
  if (btnSend) {
    btnSend.disabled = false;
    btnSend.innerHTML = '📨 Yuborish';
  }
  const btnCancel = document.getElementById('btn-cancel-send');
  if (btnCancel) btnCancel.remove();

  showToast('Yuborish yakunlandi!', 'success');
}

// ============ Auto-reconnect on page load ============
export async function tryAutoReconnect() {
  if (hasSavedSession()) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh;">
        <div class="spinner spinner-large"></div>
        <p style="color: var(--text-secondary); margin-top: 16px;">Sessiya tiklanmoqda...</p>
      </div>
    `;

    const reconnected = await reconnectFromSession();
    if (reconnected) {
      state.connected = true;
      state.user = await getCurrentUser();
      state.step = 2;
      render();
      showToast('Sessiya tiklandi ✅', 'success');
      
      // Sync history from Telegram in the background
      syncHistoryFromTelegram().catch((err) => console.error('Auto DB sync error:', err));

      loadDialogs();
      return;
    }
  }

  render();
}
