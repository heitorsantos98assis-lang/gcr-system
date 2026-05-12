function fmtInt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('pt-BR');
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0,00%';
  return n.toFixed(2).replace('.', ',') + '%';
}

function fmtDec(n, casas = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0,00';
  return n.toFixed(casas).replace('.', ',');
}

function progressBar(pct, width = 10) {
  const filled = Math.min(width, Math.max(0, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function statusEmoji(pct) {
  if (pct >= 100) return '🟢';
  if (pct >= 70) return '🟡';
  if (pct >= 40) return '🟠';
  return '🔴';
}

function topN(list, n = 3) {
  return [...list]
    .filter(x => x.count > 0 && x.label && x.label !== 'Cargo' && x.label !== 'Colaboradores' && x.label !== 'Faturamento')
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function buildReportMessage(snapshot) {
  const { yesterday, cumulative, params, breakdowns } = snapshot;
  const alvoDiario = params.alvoDiario || 0;

  const lines = [];
  lines.push('📊 *Relatório Diário GCR*');
  lines.push(`_Dados consolidados de ${yesterday.dateStr}_`);
  lines.push('');

  // Yesterday's performance
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`*🎯 Ontem (${yesterday.dateStr})*`);
  lines.push('');
  const pctLeadsDia = alvoDiario > 0 ? (yesterday.leads / alvoDiario) * 100 : 0;
  lines.push(`${statusEmoji(pctLeadsDia)} Leads: *${fmtInt(yesterday.leads)}* / ${fmtInt(alvoDiario)}  (${fmtPct(pctLeadsDia)})`);
  lines.push(`   ${progressBar(pctLeadsDia)}`);
  lines.push(`🏆 MQLs: *${fmtInt(yesterday.mqls)}*  (conv. ${fmtPct(yesterday.pctConv)})`);
  lines.push('');

  // Cumulative campaign
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('*📈 Acumulado da Campanha*');
  lines.push(`_Até o final de ${yesterday.dateStr}_`);
  lines.push('');
  lines.push(`${statusEmoji(cumulative.pctAtingLeadsAcum)} Total Leads: *${fmtInt(cumulative.totalLeads)}* / ${fmtInt(cumulative.alvoAcumLeads)}  (${fmtPct(cumulative.pctAtingLeadsAcum)})`);
  lines.push(`   ${progressBar(cumulative.pctAtingLeadsAcum)}`);
  lines.push(`${statusEmoji(cumulative.pctAtingMqlsAcum)} Total MQLs: *${fmtInt(cumulative.totalMqls)}* / ${fmtDec(cumulative.alvoAcumMqls, 1)}  (${fmtPct(cumulative.pctAtingMqlsAcum)})`);
  lines.push(`   ${progressBar(cumulative.pctAtingMqlsAcum)}`);
  lines.push('');
  lines.push(`💱 Taxa Conversão Lead→MQL: *${fmtPct(cumulative.taxaConv)}*`);
  lines.push(`📅 Dias decorridos: *${fmtInt(cumulative.diasDecorridos)}*`);
  lines.push(`📊 Média diária: *${fmtDec(cumulative.mediaLeadsDia)}* leads / *${fmtDec(cumulative.mediaMqlsDia)}* MQLs`);
  lines.push('');

  // Strategic breakdowns (top 3 each)
  const topCargo = topN(breakdowns.cargo);
  const topFat = topN(breakdowns.faturamento);
  if (topCargo.length || topFat.length) {
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('*🔍 Quebras Estratégicas*');
    lines.push('');
    if (topCargo.length) {
      lines.push('*Top Cargos*');
      for (const item of topCargo) {
        lines.push(`• ${item.label}: ${fmtInt(item.count)}`);
      }
      lines.push('');
    }
    if (topFat.length) {
      lines.push('*Top Faturamento*');
      for (const item of topFat) {
        lines.push(`• ${item.label}: ${fmtInt(item.count)}`);
      }
      lines.push('');
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('_Próximo relatório: amanhã às 06:00 BRT_');

  return lines.join('\n');
}

module.exports = { buildReportMessage, fmtInt, fmtPct, fmtDec };
