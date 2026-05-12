// Test que baixa a planilha real, parseia, calcula o snapshot de "ontem" e gera a mensagem.
// Roda com: node test/metrics.test.js
const { loadMetrics, computeYesterdaySnapshot } = require('../lib/metrics');
const { buildReportMessage } = require('../lib/message');

(async () => {
  console.log('=== Baixando planilha GCR ===');
  const metrics = await loadMetrics();

  console.log('\n=== PARAMETROS ===');
  console.log(JSON.stringify(metrics.params, null, 2));

  console.log('\n=== DAILY ROWS COM DADOS (>0) ===');
  const nonZero = metrics.daily.filter(d => d.leads > 0 || d.mqls > 0);
  nonZero.forEach(d => console.log(`  ${d.dateStr}: ${d.leads} leads, ${d.mqls} MQLs (${d.pctAting}% / ${d.pctConv}%)`));
  console.log(`Total daily rows: ${metrics.daily.length}, com dados: ${nonZero.length}`);

  console.log('\n=== BREAKDOWNS ===');
  console.log('Cargo:', metrics.breakdowns.cargo.length, 'itens');
  console.log('Colaboradores:', metrics.breakdowns.colaboradores.length, 'itens');
  console.log('Faturamento:', metrics.breakdowns.faturamento.length, 'itens');
  console.log('MQLs por Faturamento:', metrics.breakdowns.mqlsFaturamento.length, 'itens');

  console.log('\n=== SNAPSHOT (yesterday) ===');
  // Simular "agora" = 13/05/2026 às 06:00 BRT → yesterday = 12/05/2026
  // Real "now" depende de quando rodar
  const snapshot = computeYesterdaySnapshot(metrics);
  console.log(`Yesterday row date: ${snapshot.yesterday.dateStr}`);
  console.log(`Yesterday leads: ${snapshot.yesterday.leads}, mqls: ${snapshot.yesterday.mqls}`);
  console.log(`Cumulative: ${snapshot.cumulative.totalLeads} leads / ${snapshot.cumulative.totalMqls} MQLs`);
  console.log(`Dias decorridos: ${snapshot.cumulative.diasDecorridos}`);
  console.log(`% Atingido leads acum: ${snapshot.cumulative.pctAtingLeadsAcum.toFixed(2)}%`);
  console.log(`% Atingido mqls acum: ${snapshot.cumulative.pctAtingMqlsAcum.toFixed(2)}%`);
  console.log(`Taxa conv: ${snapshot.cumulative.taxaConv.toFixed(2)}%`);

  console.log('\n=== MENSAGEM FINAL ===');
  const msg = buildReportMessage(snapshot);
  console.log(msg);
  console.log('\n=== TAMANHO: ' + msg.length + ' chars ===');

  // Simular execução em 13/05/2026 06:00 BRT (yesterday = 12/05/2026)
  console.log('\n=== SIMULAÇÃO: rodando em 13/05/2026 06:00 BRT ===');
  const simNow = new Date(Date.UTC(2026, 4, 13, 9, 0, 0)); // 06:00 BRT = 09:00 UTC
  const snap2 = computeYesterdaySnapshot(metrics, simNow);
  console.log(`Yesterday: ${snap2.yesterday.dateStr}, leads=${snap2.yesterday.leads}, mqls=${snap2.yesterday.mqls}`);
  console.log(buildReportMessage(snap2));
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
