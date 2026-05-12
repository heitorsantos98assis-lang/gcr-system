const { fetchCsv, parseCsv, METRICS_GID } = require('./sheets');

// Parse Brazilian-formatted numbers: "19,05%" -> 19.05, "3,23" -> 3.23, "42,00" -> 42
function parseBrNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Strip percent sign, thousand separators, and replace decimal comma
  const cleaned = s.replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Parse DD/MM/YYYY into a JS Date (local TZ-agnostic, anchored to noon to avoid DST drift)
function parseBrDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const y = parseInt(m[3], 10);
  return new Date(Date.UTC(y, mo, d, 12, 0, 0));
}

function formatBrDate(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yy = date.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

// Returns Date object representing "yesterday" in America/Sao_Paulo timezone (UTC-3, no DST)
function getYesterdayBrt(now = new Date()) {
  // Sao Paulo is UTC-3 year-round (no DST since 2019)
  const utcMs = now.getTime();
  const brtMs = utcMs - (3 * 60 * 60 * 1000);
  const brt = new Date(brtMs);
  // Subtract one day
  brt.setUTCDate(brt.getUTCDate() - 1);
  // Normalize to midday UTC to align with parseBrDate
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), 12, 0, 0));
}

/**
 * Parses the Metricas GCR sheet into a structured KPI object.
 * Sections:
 *  - PARAMETROS DA CAMPANHA  (col A/B, rows 1-5)
 *  - RESUMO EXECUTIVO        (col D/E, rows 1-10)
 *  - ACOMPANHAMENTO DIARIO   (header at "ACOMPANHAMENTO DIARIO", then 6 columns of daily data)
 *  - QUEBRAS ESTRATEGICAS    (4 breakdown tables side-by-side)
 */
function parseMetricsSheet(rows) {
  const params = {};
  const summary = {};
  const dailyRows = []; // {date, leads, alvo, pctAting, mqls, pctConv}
  const breakdowns = { cargo: [], colaboradores: [], faturamento: [], mqlsFaturamento: [] };

  // Find row indices of section markers
  let acompIdx = -1;
  let quebrasIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (r[0] === 'ACOMPANHAMENTO DIARIO') acompIdx = i;
    if (r[0] === 'QUEBRAS ESTRATEGICAS') quebrasIdx = i;
  }

  // PARAMETROS (col 0 = label, col 1 = value) — rows 1 through 5 typically
  for (let i = 1; i <= 5 && i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    if (r[0] === 'Data inicial da campanha') params.dataInicial = r[1];
    if (r[0] === 'Data final da campanha') params.dataFinal = r[1];
    if (r[0] === 'Alvo diario de Leads') params.alvoDiario = parseBrNumber(r[1]);
    if (r[0] === '% MQL sobre Leads (alvo)') params.alvoMqlPct = r[1];
    if (r[0] === 'Pontuacao minima para MQL') params.pontMinMql = parseBrNumber(r[1]);
  }

  // RESUMO EXECUTIVO (col 3 = label, col 4 = value)
  for (let i = 1; i < (acompIdx > 0 ? acompIdx : 12); i++) {
    const r = rows[i];
    if (!r || !r[3]) continue;
    const label = r[3];
    const value = r[4];
    if (label === 'Total de Leads') summary.totalLeads = parseBrNumber(value);
    else if (label === 'Total de MQLs') summary.totalMqls = parseBrNumber(value);
    else if (label === 'Taxa Conv. Lead->MQL') summary.taxaConv = parseBrNumber(value);
    else if (label === 'Dias decorridos') summary.diasDecorridos = parseBrNumber(value);
    else if (label === 'Media Leads/dia') summary.mediaLeadsDia = parseBrNumber(value);
    else if (label === 'Media MQLs/dia') summary.mediaMqlsDia = parseBrNumber(value);
    else if (label === 'Alvo acumulado Leads') summary.alvoAcumLeads = parseBrNumber(value);
    else if (label === 'Alvo acumulado MQLs') summary.alvoAcumMqls = parseBrNumber(value);
    else if (label === '% Atingido Leads acum') summary.pctAtingLeadsAcum = parseBrNumber(value);
    else if (label === '% Atingido MQLs acum') summary.pctAtingMqlsAcum = parseBrNumber(value);
  }

  // ACOMPANHAMENTO DIARIO — rows after header
  if (acompIdx >= 0) {
    // headers in next row, data from acompIdx + 2 onward, until empty
    const endIdx = quebrasIdx > 0 ? quebrasIdx : rows.length;
    for (let i = acompIdx + 2; i < endIdx; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const date = parseBrDate(r[0]);
      if (!date) continue;
      dailyRows.push({
        date,
        dateStr: r[0],
        leads: parseBrNumber(r[1]) || 0,
        alvo: parseBrNumber(r[2]) || 0,
        pctAting: parseBrNumber(r[3]) || 0,
        mqls: parseBrNumber(r[4]) || 0,
        pctConv: parseBrNumber(r[5]) || 0,
      });
    }
  }

  // QUEBRAS ESTRATEGICAS — 4 tables, columns 0/1, 3/4, 6/7, 9/10
  if (quebrasIdx >= 0) {
    // The breakdown header row is quebrasIdx + 2, data starts at quebrasIdx + 3
    for (let i = quebrasIdx + 3; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      if (r[0]) breakdowns.cargo.push({ label: r[0], count: parseBrNumber(r[1]) || 0 });
      if (r[3]) breakdowns.colaboradores.push({ label: r[3], count: parseBrNumber(r[4]) || 0 });
      if (r[6]) breakdowns.faturamento.push({ label: r[6], count: parseBrNumber(r[7]) || 0 });
      if (r[9]) breakdowns.mqlsFaturamento.push({ label: r[9], count: parseBrNumber(r[10]) || 0 });
    }
  }

  return { params, summary, daily: dailyRows, breakdowns };
}

/**
 * Computes the "yesterday snapshot" KPIs that will go into the morning message.
 * Returns: daily row for yesterday + cumulative totals through end-of-yesterday.
 */
function computeYesterdaySnapshot(metrics, now = new Date()) {
  const yesterday = getYesterdayBrt(now);
  const yesterdayKey = formatBrDate(yesterday);

  const yRow = metrics.daily.find(d => d.dateStr === yesterdayKey)
    || metrics.daily.find(d => d.date.getTime() === yesterday.getTime())
    || { dateStr: yesterdayKey, leads: 0, alvo: metrics.params.alvoDiario || 0, pctAting: 0, mqls: 0, pctConv: 0 };

  // Cumulative through yesterday (sum of all daily rows where date <= yesterday)
  let cumLeads = 0, cumMqls = 0, daysWithData = 0;
  for (const d of metrics.daily) {
    if (d.date.getTime() <= yesterday.getTime()) {
      cumLeads += d.leads;
      cumMqls += d.mqls;
      if (d.leads > 0 || d.mqls > 0) daysWithData++;
    }
  }

  // Days elapsed from campaign start to yesterday (inclusive)
  let diasDecorridos = 0;
  const start = parseBrDate(metrics.params.dataInicial);
  if (start) {
    const diffMs = yesterday.getTime() - start.getTime();
    diasDecorridos = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
    if (diasDecorridos < 0) diasDecorridos = 0;
  }

  const alvoDiario = metrics.params.alvoDiario || 0;
  const alvoAcumLeads = alvoDiario * diasDecorridos;
  // Alvo MQL: lê o "% MQL sobre Leads (alvo)" (string como "30%")
  const alvoMqlPctNum = parseBrNumber(metrics.params.alvoMqlPct) || 30;
  const alvoAcumMqls = (alvoAcumLeads * alvoMqlPctNum) / 100;

  const pctAtingLeadsAcum = alvoAcumLeads > 0 ? (cumLeads / alvoAcumLeads) * 100 : 0;
  const pctAtingMqlsAcum = alvoAcumMqls > 0 ? (cumMqls / alvoAcumMqls) * 100 : 0;
  const taxaConv = cumLeads > 0 ? (cumMqls / cumLeads) * 100 : 0;
  const mediaLeads = diasDecorridos > 0 ? cumLeads / diasDecorridos : 0;
  const mediaMqls = diasDecorridos > 0 ? cumMqls / diasDecorridos : 0;

  return {
    yesterday: yRow,
    cumulative: {
      totalLeads: cumLeads,
      totalMqls: cumMqls,
      diasDecorridos,
      alvoAcumLeads,
      alvoAcumMqls,
      pctAtingLeadsAcum,
      pctAtingMqlsAcum,
      taxaConv,
      mediaLeadsDia: mediaLeads,
      mediaMqlsDia: mediaMqls,
    },
    params: metrics.params,
    breakdowns: metrics.breakdowns,
  };
}

async function loadMetrics() {
  const csv = await fetchCsv(METRICS_GID);
  const rows = parseCsv(csv);
  return parseMetricsSheet(rows);
}

module.exports = {
  parseBrNumber,
  parseBrDate,
  formatBrDate,
  getYesterdayBrt,
  parseMetricsSheet,
  computeYesterdaySnapshot,
  loadMetrics,
};
