const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const SESSION_DATA_PATH = process.env.SESSION_DATA_PATH || './.wwebjs_auth';

// Baileys logger — silenced by default to keep Railway logs clean
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

let sock = null;
let currentQrDataUrl = null;
let connected = false;
let initializing = false;
let lastError = null;
let userInfo = null;
let knownGroups = []; // [{ id, name }]
let lastGroupsCount = 0;
let lastRefreshAt = null;
let initPromise = null;

async function initClient() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    initializing = true;
    lastError = null;

    // Ensure session directory exists
    try { fs.mkdirSync(SESSION_DATA_PATH, { recursive: true }); } catch {}

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DATA_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('GCR Worker'),
      syncFullHistory: false,        // We don't need chat history, just groups
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,    // Stay invisible — don't appear online
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
          console.log('[wa] QR gerado, aguardando scan...');
        } catch (e) {
          console.error('[wa] Erro ao gerar QR:', e);
        }
      }

      if (connection === 'open') {
        connected = true;
        initializing = false;
        currentQrDataUrl = null;
        try {
          const me = sock.user || {};
          // me.id looks like "5511915067585:80@s.whatsapp.net" — extract number
          const numberRaw = String(me.id || '').split('@')[0].split(':')[0];
          userInfo = { name: me.name || me.verifiedName || null, number: numberRaw || null };
        } catch {}
        console.log(`[wa] Conectado como ${userInfo?.name} (${userInfo?.number})`);
        // Fetch groups immediately — Baileys doesn't need UI sync
        setTimeout(() => { refreshGroups().catch(() => {}); }, 1500);
      }

      if (connection === 'close') {
        connected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        lastError = `connection_close: code=${code}, shouldReconnect=${shouldReconnect}`;
        console.warn(`[wa] Connection closed. code=${code}, shouldReconnect=${shouldReconnect}`);
        if (shouldReconnect) {
          // Reset and reinit
          initPromise = null;
          setTimeout(() => initClient().catch(e => console.error('[wa] reinit failed:', e)), 3000);
        }
      }
    });

    return sock;
  })();
  return initPromise;
}

async function refreshGroups(timeoutMs = 15000) {
  if (!sock || !connected) {
    return { groups: knownGroups, totalChats: 0, error: 'not_connected', source: 'cache' };
  }
  try {
    const map = await Promise.race([
      sock.groupFetchAllParticipating(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('groupFetchAllParticipating timeout')), timeoutMs)),
    ]);
    knownGroups = Object.values(map).map(g => ({
      id: g.id,
      name: g.subject || '',
    })).filter(g => g.id && g.name);
    lastGroupsCount = knownGroups.length;
    lastRefreshAt = new Date().toISOString();
    console.log(`[wa] refreshGroups: ${knownGroups.length} grupos`);
    return { groups: knownGroups, totalChats: knownGroups.length, error: null, source: 'baileys' };
  } catch (e) {
    console.error('[wa] Erro ao listar grupos:', e.message);
    return { groups: knownGroups, totalChats: lastGroupsCount, error: String(e.message || e), source: 'failed' };
  }
}

async function sendToGroups(groupIds, message) {
  if (!sock || !connected) throw new Error('WhatsApp client not connected');
  const results = [];
  for (const gid of groupIds) {
    try {
      await sock.sendMessage(gid, { text: message });
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
      totalChats: lastGroupsCount,
      groupsCount: lastGroupsCount,
      lastRefreshAt,
      pollingActive: false,
      backend: 'baileys',
    },
  };
}

function normalizeName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function resolveGroupsByName(names) {
  const resolved = [];
  const unmatched = [];
  for (const name of names) {
    const target = normalizeName(name);
    let match = knownGroups.find(g => normalizeName(g.name) === target);
    if (!match) {
      const targetNoAccents = target.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      match = knownGroups.find(g => {
        const gn = normalizeName(g.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return gn === targetNoAccents;
      });
    }
    if (match) resolved.push({ name: match.name, id: match.id });
    else unmatched.push(name);
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
