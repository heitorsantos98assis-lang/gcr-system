const fetch = require('node-fetch');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM';
const METRICS_GID = process.env.METRICS_GID || '1981009125';
const LEADS_GID = process.env.LEADS_GID || '0';

function buildCsvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
}

async function fetchCsv(gid) {
  const url = buildCsvUrl(gid);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Falha ao baixar planilha gid=${gid}: HTTP ${res.status}`);
  }
  return await res.text();
}

// Minimal CSV parser that respects quoted fields (handles embedded commas, escaped quotes, CRLF)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // ignore
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

module.exports = { fetchCsv, parseCsv, buildCsvUrl, SPREADSHEET_ID, METRICS_GID, LEADS_GID };
