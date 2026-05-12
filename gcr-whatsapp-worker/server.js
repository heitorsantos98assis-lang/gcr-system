const express = require('express');
const path = require('path');
const cron = require('node-cron');
const wa = require('./lib/whatsapp');
const { loadMetrics, computeYesterdaySnapshot } = require('./lib/metrics');
const { buildReportMessage } = require('./lib/message');

const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ_CRON || 'America/Sao_Paulo';
const SCHEDULE = process.env.CRON_SCHEDULE || '0 6 * * *'; // 06:00 daily
const TARGET_GROUP_IDS = (process.env.TARGET_GROUP_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const TARGET_GROUP_NAMES = (process.env.TARGET_GROUP_NAMES || 'GESTÃO ANTONIO E CELSO')
  .split(',').map(s => s.trim()).filter(Boolean);

const recentLogs = []; // [{time, results, messageLength}]
function logSend(results, messageLength) {
  recentLogs.unshift({ time: new Date().toISOString(), results, messageLength });
  while (recentLogs.length > 20) recentLogs.pop();
}

let lastReport = null;
let nextReport = null;

async function runReport(triggeredBy = 'cron') {
  console.log(`[report] Disparado por ${triggeredBy}`);

  const status = wa.getStatus();

  // Resolve target groups: IDs (most specific) > Names (auto-resolve) > all groups (fallback)
  let targets = [];
  let resolutionLog = null;
  if (TARGET_GROUP_IDS.length) {
    targets = TARGET_GROUP_IDS;
    resolutionLog = `por ID: ${TARGET_GROUP_IDS.length} grupo(s)`;
  } else if (TARGET_GROUP_NAMES.length) {
    const { resolved, unmatched } = wa.resolveGroupsByName(TARGET_GROUP_NAMES);
    targets = resolved.map(g => g.id);
    resolutionLog = `por nome: ${resolved.length} resolvido(s) [${resolved.map(g => g.name).join(', ')}]`;
    if (unmatched.length) {
      const err = `Grupos não encontrados na conta conectada: ${unmatched.join(', ')}. Disponíveis: ${status.groups.map(g => g.name).join(' | ')}`;
      console.error(`[report] ${err}`);
      if (resolved.length === 0) {
        logSend([{ group: 'N/A', success: false, error: err }], 0);
        return { success: false, error: err };
      }
    }
  } else {
    targets = status.groups.map(g => g.id);
    resolutionLog = `fallback: TODOS os grupos (${targets.length})`;
  }
  console.log(`[report] Grupos-alvo resolvidos ${resolutionLog}`);

  if (!status.connected) {
    const err = 'WhatsApp não conectado, relatório não enviado.';
    console.error(`[report] ${err}`);
    logSend([{ group: 'N/A', success: false, error: err }], 0);
    return { success: false, error: err };
  }

  if (targets.length === 0) {
    const err = 'Nenhum grupo-alvo resolvido. Verifique TARGET_GROUP_IDS ou TARGET_GROUP_NAMES.';
    console.error(`[report] ${err}`);
    logSend([{ group: 'N/A', success: false, error: err }], 0);
    return { success: false, error: err };
  }

  // Only fetch metrics & build message after we know we have targets
  const metrics = await loadMetrics();
  const snapshot = computeYesterdaySnapshot(metrics);
  const message = buildReportMessage(snapshot);

  const results = await wa.sendToGroups(targets, message);
  lastReport = new Date().toISOString();
  logSend(results, message.length);
  return { success: results.every(r => r.success), results, message };
}

// ---- Express server ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  const s = wa.getStatus();
  const nameResolution = TARGET_GROUP_NAMES.length && !TARGET_GROUP_IDS.length
    ? wa.resolveGroupsByName(TARGET_GROUP_NAMES)
    : null;
  res.json({
    ...s,
    targetGroupIds: TARGET_GROUP_IDS,
    targetGroupNames: TARGET_GROUP_NAMES,
    targetGroupNamesResolved: nameResolution?.resolved || [],
    targetGroupNamesUnmatched: nameResolution?.unmatched || [],
    schedule: SCHEDULE,
    timezone: TZ,
    lastReport,
    nextReport,
    recentLogs: recentLogs.slice(0, 10),
    workerActive: true,
  });
});

app.get('/api/qr', (req, res) => {
  const qr = wa.getQrDataUrl();
  if (!qr) return res.status(404).json({ error: 'QR not available' });
  res.json({ qr });
});

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await wa.refreshGroups();
    res.json({ groups });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/send-now', async (req, res) => {
  try {
    const result = await runReport('manual');
    res.json(result);
  } catch (e) {
    console.error('[api] send-now error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/preview', async (req, res) => {
  try {
    const metrics = await loadMetrics();
    const snapshot = computeYesterdaySnapshot(metrics);
    const message = buildReportMessage(snapshot);
    res.json({ snapshot, message });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- Cron job ----
function scheduleCron() {
  if (!cron.validate(SCHEDULE)) {
    console.error(`[cron] Schedule inválido: ${SCHEDULE}`);
    return;
  }
  console.log(`[cron] Agendado: "${SCHEDULE}" timezone=${TZ}`);
  cron.schedule(SCHEDULE, async () => {
    try {
      await runReport('cron');
    } catch (e) {
      console.error('[cron] erro:', e);
    }
  }, { timezone: TZ });

  // Compute next run for UI display (approximate: today/tomorrow at HH:MM from cron)
  const m = SCHEDULE.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*/);
  if (m) {
    const hour = parseInt(m[2], 10);
    const minute = parseInt(m[1], 10);
    const now = new Date();
    // BRT = UTC-3
    const brtNow = new Date(now.getTime() - 3 * 3600 * 1000);
    let next = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate(), hour, minute, 0));
    if (next.getTime() <= brtNow.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    // back to real UTC
    nextReport = new Date(next.getTime() + 3 * 3600 * 1000).toISOString();
  }
}

// ---- Boot ----
app.listen(PORT, () => {
  console.log(`[server] GCR WhatsApp Worker rodando em http://localhost:${PORT}`);
  console.log(`[server] Schedule: ${SCHEDULE} (${TZ})`);
  if (TARGET_GROUP_IDS.length) {
    console.log(`[server] Grupos-alvo (IDs): ${TARGET_GROUP_IDS.join(', ')}`);
  } else if (TARGET_GROUP_NAMES.length) {
    console.log(`[server] Grupos-alvo (nomes): ${TARGET_GROUP_NAMES.join(', ')}  ← resolvido no envio`);
  } else {
    console.log(`[server] Grupos-alvo: TODOS os grupos disponíveis (fallback)`);
  }
});

scheduleCron();

wa.initClient().catch(e => {
  console.error('[server] Falha ao iniciar WhatsApp:', e);
});

// graceful shutdown
process.on('SIGTERM', () => { console.log('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.log('SIGINT'); process.exit(0); });
