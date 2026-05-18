import React, { useEffect, useState, useMemo } from 'react';
import { fetchCsv, parseCsv, parseMetricsSheet, METRICS_GID } from './lib/sheets.js';

// URL pública do WhatsApp Worker (pode ser sobrescrita via VITE_WORKER_URL no build)
const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'https://gcr-system-production.up.railway.app/';

const fmtInt = (n) => (n == null || !Number.isFinite(n)) ? '0' : Math.round(n).toLocaleString('pt-BR');
const fmtPct = (n) => (n == null || !Number.isFinite(n)) ? '0,00%' : n.toFixed(2).replace('.', ',') + '%';
const fmtDec = (n, c = 2) => (n == null || !Number.isFinite(n)) ? '0,00' : n.toFixed(c).replace('.', ',');

function statusColor(pct) {
  if (pct >= 100) return 'text-secondary';
  if (pct >= 70) return 'text-yellow-300';
  if (pct >= 40) return 'text-orange-300';
  return 'text-tertiary';
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-container/60 border border-outline-variant/40 rounded-xl p-5 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, accent = 'primary' }) {
  const ring = accent === 'secondary' ? 'border-secondary/30' : accent === 'tertiary' ? 'border-tertiary/30' : 'border-primary/30';
  return (
    <Card className={`${ring}`}>
      <div className="text-[0.65rem] tracking-[0.18em] uppercase text-on-surface-variant font-bold mb-2">{label}</div>
      <div className="text-3xl md:text-4xl font-black text-on-surface tabular-nums">{value}</div>
      {sub && <div className="text-xs text-on-surface-variant mt-1">{sub}</div>}
    </Card>
  );
}

function ProgressBar({ pct, color = 'primary' }) {
  const fill = color === 'secondary' ? 'bg-secondary' : color === 'tertiary' ? 'bg-tertiary' : 'bg-primary';
  return (
    <div className="w-full h-2 bg-surface-container-lowest rounded-full overflow-hidden mt-2">
      <div className={`h-full ${fill} rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function DailyChart({ daily }) {
  const max = Math.max(...daily.map(d => Math.max(d.leads, d.alvo)), 1);
  // show only rows with date <= today + 1, or only with data
  const today = new Date();
  const todayMs = today.getTime();
  const visible = daily.filter(d => d.date.getTime() <= todayMs + 24 * 3600 * 1000);
  const shown = visible.length > 0 ? visible : daily.slice(0, 30);
  return (
    <Card>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-bold text-primary tracking-wider uppercase">Acompanhamento Diário</h3>
        <span className="text-xs text-on-surface-variant">{shown.length} dias</span>
      </div>
      <div className="overflow-x-auto -mx-2 px-2">
        <div className="flex items-end gap-1 min-w-full" style={{ height: '180px' }}>
          {shown.map((d, i) => {
            const hLeads = (d.leads / max) * 100;
            const hAlvo = (d.alvo / max) * 100;
            const pct = d.alvo > 0 ? (d.leads / d.alvo) * 100 : 0;
            const color = pct >= 100 ? 'bg-secondary' : pct >= 70 ? 'bg-yellow-300' : pct >= 40 ? 'bg-orange-300' : 'bg-tertiary';
            return (
              <div key={i} className="flex flex-col items-center flex-1 min-w-[18px] group" title={`${d.dateStr}: ${d.leads} leads / ${d.mqls} MQLs`}>
                <div className="flex-1 w-full flex flex-col-reverse relative">
                  <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-outline-variant/30" style={{ bottom: `${hAlvo}%` }} />
                  <div className={`w-full rounded-t ${color} transition-all group-hover:opacity-100 opacity-80`} style={{ height: `${hLeads}%`, minHeight: d.leads > 0 ? '3px' : '0' }} />
                </div>
                <div className="text-[9px] text-on-surface-variant mt-1 -rotate-45 origin-top-left whitespace-nowrap" style={{ height: '32px' }}>
                  {d.dateStr.slice(0, 5)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-3 text-xs text-on-surface-variant mt-2">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-secondary rounded-sm"></span>≥100%</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-yellow-300 rounded-sm"></span>70%+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-orange-300 rounded-sm"></span>40%+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-tertiary rounded-sm"></span>&lt;40%</span>
        <span className="ml-auto">- - - alvo diário</span>
      </div>
    </Card>
  );
}

function BreakdownTable({ title, items }) {
  const filtered = items.filter(i => i.count > 0 && i.label && !['Cargo', 'Colaboradores', 'Faturamento'].includes(i.label));
  const total = filtered.reduce((s, i) => s + i.count, 0);
  const sorted = [...filtered].sort((a, b) => b.count - a.count);
  return (
    <Card>
      <h3 className="text-sm font-bold text-primary tracking-wider uppercase mb-3">{title}</h3>
      <div className="space-y-2">
        {sorted.map((it, i) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          return (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-on-surface truncate pr-2">{it.label}</span>
                <span className="text-on-surface-variant tabular-nums">{fmtInt(it.count)} · {fmtPct(pct)}</span>
              </div>
              <div className="w-full h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
                <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && <div className="text-xs text-on-surface-variant italic">Sem dados ainda</div>}
      </div>
    </Card>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  async function refresh() {
    try {
      setError(null);
      const csv = await fetchCsv(METRICS_GID);
      const rows = parseCsv(csv);
      const m = parseMetricsSheet(rows);
      setData(m);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000); // refresh every 60s
    return () => clearInterval(id);
  }, []);

  const s = data?.summary || {};
  const p = data?.params || {};

  const today = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600 * 1000);
    const key = `${String(brt.getUTCDate()).padStart(2, '0')}/${String(brt.getUTCMonth() + 1).padStart(2, '0')}/${brt.getUTCFullYear()}`;
    return data.daily.find(d => d.dateStr === key);
  }, [data]);

  const yesterday = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600 * 1000);
    brt.setUTCDate(brt.getUTCDate() - 1);
    const key = `${String(brt.getUTCDate()).padStart(2, '0')}/${String(brt.getUTCMonth() + 1).padStart(2, '0')}/${brt.getUTCFullYear()}`;
    return data.daily.find(d => d.dateStr === key);
  }, [data]);

  if (loading && !data) {
    return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">Carregando dados da planilha…</div>;
  }
  if (error && !data) {
    return <div className="min-h-screen flex items-center justify-center text-tertiary">Erro: {error}</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-container-low to-surface px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[0.65rem] font-extrabold tracking-[0.18em] uppercase px-2 py-1 rounded bg-primary/10 text-primary">
              GCR · Gestão com Resultado
            </span>
            {error && <span className="text-xs text-tertiary">⚠ {error}</span>}
            <a
              href={WORKER_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir painel do WhatsApp Worker"
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/10 text-secondary border border-secondary/30 hover:bg-secondary/20 transition-all text-xs font-bold"
            >
              <span className="material-symbols-outlined text-base leading-none">forum</span>
              WhatsApp Worker
            </a>
          </div>
          <h1 className="text-3xl md:text-5xl font-black bg-gradient-to-br from-primary to-secondary bg-clip-text text-transparent">
            Painel de Métricas
          </h1>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-on-surface-variant">
            <span>Campanha: <strong className="text-on-surface">{p.dataInicial} → {p.dataFinal}</strong></span>
            <span>Alvo diário: <strong className="text-on-surface">{fmtInt(p.alvoDiario)} leads</strong></span>
            <span>Meta MQL: <strong className="text-on-surface">{p.alvoMqlPct}</strong></span>
            <span>Pontuação MQL: <strong className="text-on-surface">≥ {fmtInt(p.pontMinMql)}</strong></span>
            {lastFetch && <span className="ml-auto">Atualizado: <strong className="text-on-surface">{lastFetch.toLocaleTimeString('pt-BR')}</strong></span>}
          </div>
        </header>

        {/* KPI Row 1: Executive Summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <KpiCard label="Total de Leads" value={fmtInt(s.totalLeads)} sub={`${fmtInt(s.alvoAcumLeads)} alvo acumulado`} />
          <KpiCard label="Total de MQLs" value={fmtInt(s.totalMqls)} sub={`${fmtDec(s.alvoAcumMqls, 1)} alvo acumulado`} accent="secondary" />
          <KpiCard label="Conv. Lead → MQL" value={fmtPct(s.taxaConv)} sub={`Limiar: ≥ ${fmtInt(p.pontMinMql)} pts`} accent="secondary" />
          <KpiCard label="Dias decorridos" value={fmtInt(s.diasDecorridos)} sub={`Média ${fmtDec(s.mediaLeadsDia)} leads/dia`} />
        </section>

        {/* KPI Row 2: Attainment */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <Card>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-[0.65rem] tracking-[0.18em] uppercase text-on-surface-variant font-bold">% Atingido Leads (acum.)</div>
              <div className={`text-2xl font-black ${statusColor(s.pctAtingLeadsAcum)}`}>{fmtPct(s.pctAtingLeadsAcum)}</div>
            </div>
            <div className="text-xs text-on-surface-variant">{fmtInt(s.totalLeads)} de {fmtInt(s.alvoAcumLeads)} leads</div>
            <ProgressBar pct={s.pctAtingLeadsAcum || 0} />
          </Card>
          <Card>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-[0.65rem] tracking-[0.18em] uppercase text-on-surface-variant font-bold">% Atingido MQLs (acum.)</div>
              <div className={`text-2xl font-black ${statusColor(s.pctAtingMqlsAcum)}`}>{fmtPct(s.pctAtingMqlsAcum)}</div>
            </div>
            <div className="text-xs text-on-surface-variant">{fmtInt(s.totalMqls)} de {fmtDec(s.alvoAcumMqls, 1)} MQLs</div>
            <ProgressBar pct={s.pctAtingMqlsAcum || 0} color="secondary" />
          </Card>
        </section>

        {/* Today + Yesterday side by side */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <Card>
            <h3 className="text-sm font-bold text-primary tracking-wider uppercase mb-3">Hoje</h3>
            {today ? (
              <div className="space-y-2">
                <div className="flex justify-between"><span>Leads</span><strong className="tabular-nums">{fmtInt(today.leads)} / {fmtInt(today.alvo)}</strong></div>
                <ProgressBar pct={today.pctAting} />
                <div className="flex justify-between text-sm"><span>MQLs</span><strong className="tabular-nums text-secondary">{fmtInt(today.mqls)}</strong></div>
                <div className="text-xs text-on-surface-variant">{fmtPct(today.pctAting)} do alvo</div>
              </div>
            ) : <div className="text-sm text-on-surface-variant italic">Sem dados de hoje ainda</div>}
          </Card>
          <Card>
            <h3 className="text-sm font-bold text-primary tracking-wider uppercase mb-3">Ontem</h3>
            {yesterday ? (
              <div className="space-y-2">
                <div className="flex justify-between"><span>Leads</span><strong className="tabular-nums">{fmtInt(yesterday.leads)} / { fmtInt(yesterday.alvo)}</strong></div>
                <ProgressBar pct={yesterday.pctAting} />
                <div className="flex justify-between text-sm"><span>MQLs</span><strong className="tabular-nums text-secondary">{fmtInt(yesterday.mqls)}</strong></div>
                <div className="text-xs text-on-surface-variant">{fmtPct(yesterday.pctAting)} do alvo · conv {fmtPct(yesterday.pctConv)}</div>
              </div>
            ) : <div className="text-sm text-on-surface-variant italic">Sem dados de ontem</div>}
          </Card>
        </section>

        {/* Daily chart */}
        <section className="mb-5">
          <DailyChart daily={data.daily} />
        </section>

        {/* Strategic breakdowns */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <BreakdownTable title="Leads por Cargo" items={data.breakdowns.cargo} />
          <BreakdownTable title="Leads por Tamanho de Empresa" items={data.breakdowns.colaboradores} />
          <BreakdownTable title="Leads por Faturamento" items={data.breakdowns.faturamento} />
          <BreakdownTable title="MQLs por Faturamento" items={data.breakdowns.mqlsFaturamento} />
        </section>

        <footer className="text-center text-xs text-on-surface-variant py-4">
          Fonte: <a className="text-primary hover:underline" href="https://docs.google.com/spreadsheets/d/1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM/edit?gid=1981009125" target="_blank" rel="noopener">Planilha GCR · Métricas</a> · Atualiza a cada 60s
        </footer>
      </div>
    </div>
  );
}
