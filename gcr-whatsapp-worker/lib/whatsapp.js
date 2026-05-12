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
    await refreshGroups();
    console.log(`[wa] Conectado como ${userInfo?.name} (${userInfo?.number})`);
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

async function refreshGroups() {
  if (!client || !connected) return [];
  try {
    const chats = await client.getChats();
    knownGroups = chats
      .filter(c => c.isGroup)
      .map(c => ({ id: c.id._serialized, name: c.name }));
    return knownGroups;
  } catch (e) {
    console.error('[wa] Erro ao listar grupos:', e);
    return [];
  }
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
  };
}

// Resolve group names (case-insensitive, trimmed) to WhatsApp IDs using the latest known groups list.
// Returns { resolved: [{name, id}], unmatched: [name, ...] }
function resolveGroupsByName(names) {
  const resolved = [];
  const unmatched = [];
  const normalize = (s) => String(s || '').trim().toLocaleLowerCase('pt-BR');
  for (const name of names) {
    const target = normalize(name);
    const match = knownGroups.find(g => normalize(g.name) === target);
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
