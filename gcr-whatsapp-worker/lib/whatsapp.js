const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const SESSION_DATA_PATH = process.env.SESSION_DATA_PATH || './.wwebjs_auth';

let client = null;
let currentQrDataUrl = null;
let connected = false;
let initializing = false;
let lastError = null;
let userInfo = null;
let knownGroups = [];
let lastChatsCount = 0;
let lastGroupsCount = 0;
let lastRefreshAt = null;

async function initClient() {
  if (client) return client;
  initializing = true;
  lastError = null;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DATA_PATH }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', async (qr) => {
    try {
      currentQrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
      console.log('[wa] QR gerado, aguardando scan...');
    } catch (e) {
      console.error('[wa] Erro ao gerar QR:', e);
    }
  });

  client.on('ready', async () => {
    connected = true;
    initializing = false;
    currentQrDataUrl = null;
    try {
      userInfo = {
        name: client.info?.pushname || null,
        number: client.info?.wid?.user || null,
      };
    } catch {}
    console.log(`[wa] Conectado como ${userInfo?.name} (${userInfo?.number}). Aguardando 6s antes do primeiro refresh...`);
    // Wait briefly for WhatsApp Web to start syncing chats, then refresh
    setTimeout(async () => {
      await refreshGroups();
      startBackgroundGroupPolling();
    }, 6000);
  });

  client.on('authenticated', () => {
    console.log('[wa] Autenticado');
  });

  client.on('auth_failure', (msg) => {
    lastError = `auth_failure: ${msg}`;
    connected = false;
    console.error('[wa] Auth failure:', msg);
  });

  client.on('disconnected', (reason) => {
    connected = false;
    lastError = `disconnected: ${reason}`;
    console.warn('[wa] Disconnected:', reason);
  });

  await client.initialize();
  return client;
}

async function refreshGroups(timeoutMs = 12000) {
  if (!client || !connected) return { groups: [], totalChats: 0, error: 'not_connected' };

  // Strategy 1: high-level client.getChats() with timeout
  try {
    const chats = await Promise.race([
      client.getChats(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('getChats timeout')), timeoutMs)),
    ]);
    const groups = chats.filter(c => c.isGroup);
    knownGroups = groups.map(c => ({ id: c.id._serialized, name: c.name }));
    lastChatsCount = chats.length;
    lastGroupsCount = groups.length;
    lastRefreshAt = new Date().toISOString();
    console.log(`[wa] refreshGroups(getChats): ${chats.length} chats total, ${groups.length} grupos`);
    return { groups: knownGroups, totalChats: chats.length, error: null, source: 'getChats' };
  } catch (e) {
    console.warn(`[wa] getChats falhou (${e.message}), tentando fallback via pupPage.evaluate...`);
  }

  // Strategy 2: bypass high-level wrapper, hit WhatsApp's internal Store directly via puppeteer
  try {
    if (!client.pupPage) throw new Error('pupPage not available');
    const data = await Promise.race([
      client.pupPage.evaluate(() => {
        // WhatsApp Web exposes Store on window after page loads
        const Store = window.Store || window.WPP?.whatsapp;
        if (!Store?.Chat?.getModelsArray) return { error: 'Store.Chat not available' };
        const all = Store.Chat.getModelsArray();
        const groups = all.filter(c => c.isGroup || c.id?.server === 'g.us');
        return {
          total: all.length,
          groups: groups.map(c => ({
            id: c.id?._serialized || (c.id?.toString?.()),
            name: c.name || c.formattedTitle || c.contact?.name || '',
          })).filter(g => g.id && g.name),
        };
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('pupPage.evaluate timeout')), timeoutMs)),
    ]);
    if (data?.error) throw new Error(data.error);
    knownGroups = data.groups || [];
    lastChatsCount = data.total || 0;
    lastGroupsCount = knownGroups.length;
    lastRefreshAt = new Date().toISOString();
    console.log(`[wa] refreshGroups(evaluate): ${lastChatsCount} chats total, ${lastGroupsCount} grupos`);
    return { groups: knownGroups, totalChats: lastChatsCount, error: null, source: 'evaluate' };
  } catch (e) {
    console.error('[wa] Fallback também falhou:', e.message);
    return { groups: knownGroups, totalChats: lastChatsCount, error: String(e.message || e), source: 'failed' };
  }
}

// Background poll: retry every 15s until groups are found (or for 5 minutes)
let pollingInterval = null;
function startBackgroundGroupPolling() {
  if (pollingInterval) return;
  console.log('[wa] Iniciando polling de grupos em background (a cada 15s)');
  let attempts = 0;
  pollingInterval = setInterval(async () => {
    attempts++;
    const before = knownGroups.length;
    await refreshGroups(8000);
    if (knownGroups.length > before) {
      console.log(`[wa] Polling encontrou ${knownGroups.length - before} grupo(s) novo(s)`);
    }
    // Stop polling after 20 attempts (5 min) if we have groups, or continue if still empty
    if (knownGroups.length > 0 && attempts >= 4) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      console.log('[wa] Polling encerrado (grupos encontrados)');
    }
    if (attempts >= 60) { // hard cap at 15 min
      clearInterval(pollingInterval);
      pollingInterval = null;
      console.log('[wa] Polling encerrado (limite de tentativas)');
    }
  }, 15000);
}

async function sendToGroups(groupIds, message) {
  if (!client || !connected) {
    throw new Error('WhatsApp client not connected');
  }
  const results = [];
  for (const gid of groupIds) {
    try {
      await client.sendMessage(gid, message);
      const groupName = knownGroups.find(g => g.id === gid)?.name || gid;
      results.push({ group: groupName, id: gid, success: true });
      console.log(`[wa] Enviado para "${groupName}"`);
    } catch (e) {
      results.push({ group: gid, id: gid, success: false, error: String(e.message || e) });
      console.error(`[wa] Falha ao enviar para ${gid}:`, e.message);
    }
  }
  return results;
}

function getStatus() {
  return {
    connected,
    initializing,
    error: lastError,
    user: userInfo,
    groups: knownGroups,
    qrAvailable: !!currentQrDataUrl,
    sync: {
      totalChats: lastChatsCount,
      groupsCount: lastGroupsCount,
      lastRefreshAt,
      pollingActive: !!pollingInterval,
    },
  };
}

// Resolve group names (Unicode NFC + case-insensitive + whitespace-collapsed) to WhatsApp IDs.
// Returns { resolved: [{name, id}], unmatched: [name, ...] }
function normalizeName(s) {
  return String(s || '')
    .normalize('NFC')                    // unify pre-composed vs decomposed accents
    .replace(/\s+/g, ' ')                // collapse whitespace
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function resolveGroupsByName(names) {
  const resolved = [];
  const unmatched = [];
  for (const name of names) {
    const target = normalizeName(name);
    // First try exact normalized match
    let match = knownGroups.find(g => normalizeName(g.name) === target);
    // Fallback 1: strip accents both sides
    if (!match) {
      const targetNoAccents = target.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      match = knownGroups.find(g => {
        const gn = normalizeName(g.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return gn === targetNoAccents;
      });
    }
    if (match) {
      resolved.push({ name: match.name, id: match.id });
    } else {
      unmatched.push(name);
    }
  }
  return { resolved, unmatched };
}

function getQrDataUrl() {
  return currentQrDataUrl;
}

module.exports = {
  initClient,
  sendToGroups,
  refreshGroups,
  resolveGroupsByName,
  getStatus,
  getQrDataUrl,
};
