const SPREADSHEET_ID = '1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM';
const METRICS_GID = '1981009125';
const LEADS_GID = '0';

export function csvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
}

export async function fetchCsv(gid) {
  const res = await fetch(csvUrl(gid));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') {}
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseBrNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseBrDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12, 0, 0));
}

export function parseMetricsSheet(rows) {
  const params = {}, summary = {};
  const daily = [];
  const breakdowns = { cargo: [], colaboradores: [], faturamento: [], mqlsFaturamento: [] };

  let acompIdx = -1, quebrasIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.[0] === 'ACOMPANHAMENTO DIARIO') acompIdx = i;
    if (rows[i]?.[0] === 'QUEBRAS ESTRATEGICAS') quebrasIdx = i;
  }

  for (let i = 1; i <= 5 && i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    if (r[0] === 'Data inicial da campanha') params.dataInicial = r[1];
    if (r[0] === 'Data final da campanha') params.dataFinal = r[1];
    if (r[0] === 'Alvo diario de Leads') params.alvoDiario = parseBrNumber(r[1]);
    if (r[0] === '% MQL sobre Leads (alvo)') params.alvoMqlPct = r[1];
    if (r[0] === 'Pontuacao minima para MQL') params.pontMinMql = parseBrNumber(r[1]);
  }

  const summaryEnd = acompIdx > 0 ? acompIdx : 12;
  for (let i = 1; i < summaryEnd; i++) {
    const r = rows[i];
    if (!r || !r[3]) continue;
    const value = r[4];
    const map = {
      'Total de Leads': 'totalLeads', 'Total de MQLs': 'totalMqls',
      'Taxa Conv. Lead->MQL': 'taxaConv', 'Dias decorridos': 'diasDecorridos',
      'Media Leads/dia': 'mediaLeadsDia', 'Media MQLs/dia': 'mediaMqlsDia',
      'Alvo acumulado Leads': 'alvoAcumLeads', 'Alvo acumulado MQLs': 'alvoAcumMqls',
      '% Atingido Leads acum': 'pctAtingLeadsAcum', '% Atingido MQLs acum': 'pctAtingMqlsAcum',
    };
    if (map[r[3]]) summary[map[r[3]]] = parseBrNumber(value);
  }

  if (acompIdx >= 0) {
    const end = quebrasIdx > 0 ? quebrasIdx : rows.length;
    for (let i = acompIdx + 2; i < end; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const date = parseBrDate(r[0]);
      if (!date) continue;
      daily.push({
        date, dateStr: r[0],
        leads: parseBrNumber(r[1]) || 0,
        alvo: parseBrNumber(r[2]) || 0,
        pctAting: parseBrNumber(r[3]) || 0,
        mqls: parseBrNumber(r[4]) || 0,
        pctConv: parseBrNumber(r[5]) || 0,
      });
    }
  }

  if (quebrasIdx >= 0) {
    for (let i = quebrasIdx + 3; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      if (r[0]) breakdowns.cargo.push({ label: r[0], count: parseBrNumber(r[1]) || 0 });
      if (r[3]) breakdowns.colaboradores.push({ label: r[3], count: parseBrNumber(r[4]) || 0 });
      if (r[6]) breakdowns.faturamento.push({ label: r[6], count: parseBrNumber(r[7]) || 0 });
      if (r[9]) breakdowns.mqlsFaturamento.push({ label: r[9], count: parseBrNumber(r[10]) || 0 });
    }
  }

  return { params, summary, daily, breakdowns };
}

export { SPREADSHEET_ID, METRICS_GID, LEADS_GID };
