# GCR Premium System

Sistema espelho do **EDN7 Premium Dashboard**, adaptado para a campanha **Gestão com Resultado (GCR)**.
Composto por dois serviços independentes (igual à arquitetura EDN7):

| Serviço | Pasta | Função |
|---|---|---|
| **Dashboard** | `gcr-dashboard/` | Visualizar os KPIs em tempo real lendo a planilha (Vite + React) |
| **WhatsApp Worker** | `gcr-whatsapp-worker/` | Enviar relatório diário às **06:00 BRT** com dados do dia anterior para grupos do WhatsApp |

---

## 🚀 Quick-start (seu caso específico)

Esta build já vem **pré-configurada para você**:

| Variável | Valor |
|---|---|
| Spreadsheet ID | `1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM` |
| Aba métricas (gid) | `1981009125` |
| Grupo-alvo (nome) | `GESTÃO ANTONIO E CELSO` |
| Telefone que escaneia o QR | `+55 XX XXXXX-XXXX` (configurado nas variáveis de ambiente) |
| Horário do envio | **06:00 BRT todos os dias** |

Não há necessidade de descobrir o ID do grupo manualmente — o worker **localiza por nome** no momento do envio (case-insensitive). Basta:

1. Deploy do worker no Railway
2. Conectar o WhatsApp do número configurado escaneando o QR code
3. Pronto — o cron das 06:00 envia automaticamente

---

## Arquitetura

```
                  ┌─────────────────────────────────────────────┐
                  │ Planilha GCR (Google Sheets - PÚBLICA)       │
                  │ 1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM │
                  │  • gid=0           → Leads brutos             │
                  │  • gid=1981009125  → Métricas GCR (KPIs)     │
                  └────────────┬───────────────────┬─────────────┘
                               │ CSV export        │ CSV export
                               │ (60s polling)     │ (no momento do envio)
                               ▼                   ▼
                  ┌──────────────────────┐  ┌────────────────────────────┐
                  │  gcr-dashboard       │  │  gcr-whatsapp-worker       │
                  │  React + Vite        │  │  Express + whatsapp-web.js │
                  │  Tema dark EDN7      │  │  cron 0 6 * * *             │
                  │  Railway service A   │  │  Railway service B          │
                  └──────────────────────┘  └─────────────┬──────────────┘
                                                          │
                                                          ▼
                                            ┌─────────────────────────┐
                                            │ Grupos do WhatsApp       │
                                            │ (configuráveis via env)  │
                                            └─────────────────────────┘
```

---

## Deploy no Railway (passo a passo)

### Pré-requisitos
- Conta no Railway com o mesmo workspace onde o EDN7 já roda
- Repositório Git (GitHub/GitLab) para hospedar o código

### 1. Subir o código para o GitHub

```bash
cd gcr-system
git init
git add .
git commit -m "GCR system initial commit"
git remote add origin git@github.com:<seu-usuario>/gcr-system.git
git push -u origin main
```

### 2. Criar os 2 serviços no Railway

No Railway, dentro do seu projeto:

#### Serviço A — Dashboard

1. **New Service** → **GitHub Repo** → selecione o repositório
2. Em **Settings → Root Directory** coloque: `gcr-dashboard`
3. Em **Settings → Build Command**: `npm run build`
4. Em **Settings → Start Command**: `npm run preview`
5. Em **Settings → Networking**, gere o domínio público

Não precisa de variáveis de ambiente — o dashboard lê direto da planilha pública.

#### Serviço B — WhatsApp Worker

1. **New Service** → **GitHub Repo** → mesmo repositório
2. Em **Settings → Root Directory** coloque: `gcr-whatsapp-worker`
3. Em **Settings → Build Command**: `npm install`
4. Em **Settings → Start Command**: `node server.js`
5. Em **Settings → Networking**, gere o domínio público
6. Em **Variables**, configure as variáveis do `.env.example`:

```env
SPREADSHEET_ID=1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM
METRICS_GID=1981009125
LEADS_GID=0
CRON_SCHEDULE=0 6 * * *
TZ_CRON=America/Sao_Paulo
TARGET_GROUP_NAMES=GESTÃO ANTONIO E CELSO
TARGET_GROUP_IDS=
SESSION_DATA_PATH=/data/wwebjs_auth
```

> A variável `TARGET_GROUP_NAMES` já vem com seu grupo pré-configurado.
> A resolução do nome para o ID `@g.us` acontece automaticamente no momento do envio,
> com matching case-insensitive. Se você renomear o grupo, basta atualizar essa variável.

7. **MUITO IMPORTANTE — Volume persistente para a sessão WhatsApp**:
   Em **Volumes** clique em **+ New Volume**, conecte ao serviço com mount path `/data`.
   Sem isso, o QR Code precisa ser escaneado novamente a cada redeploy.

### 3. Conectar o WhatsApp

1. Abra o domínio do worker no navegador (ex.: `https://gcr-whatsapp-worker-production.up.railway.app/`)
2. Aparecerá o card **"Escaneie o QR Code"**
3. No celular configurado: WhatsApp → **Aparelhos Conectados** → **Conectar um aparelho** → escaneie
4. O card vai mudar para **"Conectado"** com o nome e número da conta
5. O worker buscará automaticamente o grupo **GESTÃO ANTONIO E CELSO** entre os grupos visíveis nesse WhatsApp

> ⚠️ **O número que escanear o QR precisa ser membro do grupo GESTÃO ANTONIO E CELSO**, caso contrário o worker não conseguirá enviar mensagens nele (whatsapp-web.js só vê grupos dos quais o número está participando).

### 4. Validar o envio

Acesse a UI do worker e:
1. Verifique que o card **"Grupos-alvo"** mostra `✓ GESTÃO ANTONIO E CELSO` em verde (indica resolução bem-sucedida).
   Se aparecer `✗ GESTÃO ANTONIO E CELSO` em vermelho, o número não está no grupo ou o nome do grupo está diferente.
2. Clique em **"⚡ Enviar relatório imediatamente"** para um teste real.
3. Confirme que a mensagem chega no grupo.

A partir daí, o cron `0 6 * * *` em fuso `America/Sao_Paulo` envia automaticamente todos os dias às 06:00.

### 5. (Opcional) Travar por ID em vez de nome

Se quiser robustez contra renomeações futuras do grupo, após o primeiro deploy:

```bash
curl https://<seu-worker>.up.railway.app/api/groups
# Pegue o id do grupo (formato 120363xxx@g.us) e coloque em TARGET_GROUP_IDS
```

Quando `TARGET_GROUP_IDS` for preenchido, ele tem prioridade sobre `TARGET_GROUP_NAMES`.

---

## Endpoints do Worker

| Método | Path | Descrição |
|---|---|---|
| GET | `/` | UI de status, QR, preview e envio manual |
| GET | `/api/status` | JSON com conexão, grupos, último/próximo envio, logs |
| GET | `/api/qr` | QR Code base64 (quando desconectado) |
| GET | `/api/groups` | Lista de todos os grupos visíveis (após conectado) |
| GET | `/api/preview` | Mensagem atual que seria enviada (não envia) |
| POST | `/api/send-now` | Dispara envio imediato aos grupos-alvo |

---

## Como funciona a mensagem

A cada execução (cron ou manual), o worker:

1. Baixa a aba `Métricas GCR` (`gid=1981009125`) em CSV
2. Calcula a data de "ontem" no fuso `America/Sao_Paulo`
3. Extrai a linha do dia anterior da seção **Acompanhamento Diário**
4. **Recalcula o acumulado até o final de ontem** (somando todas as linhas diárias com data ≤ ontem) — não usa o "Total" da planilha porque esse inclui parciais de hoje
5. Recalcula automaticamente: dias decorridos, alvo acumulado, % atingido, taxa de conversão, médias diárias
6. Pega as top 3 quebras estratégicas (Cargo, Faturamento)
7. Formata em markdown WhatsApp e envia

**Exemplo da mensagem gerada** (dados reais validados em 12/05/2026 referente a 11/05):

```
📊 *Relatório Diário GCR*
_Dados consolidados de 11/05/2026_

━━━━━━━━━━━━━━━━━━━━
*🎯 Ontem (11/05/2026)*

🟠 Leads: *7* / 15  (46,67%)
   █████░░░░░
🏆 MQLs: *1*  (conv. 14,29%)

━━━━━━━━━━━━━━━━━━━━
*📈 Acumulado da Campanha*
_Até o final de 11/05/2026_

🔴 Total Leads: *37* / 180  (20,56%)
   ██░░░░░░░░
🔴 Total MQLs: *8* / 54,0  (14,81%)
   █░░░░░░░░░

💱 Taxa Conversão Lead→MQL: *21,62%*
📅 Dias decorridos: *12*
📊 Média diária: *3,08* leads / *0,67* MQLs

━━━━━━━━━━━━━━━━━━━━
*🔍 Quebras Estratégicas*

*Top Cargos*
• Sócio ou Fundador: 22
• Gerente: 6
• Outro: 6

*Top Faturamento*
• Até R$ 50 mil / mês: 24
• De R$ 50 mil a R$ 100 mil / mês: 6
• De R$ 100 mil a R$ 200 mil / mês: 4

━━━━━━━━━━━━━━━━━━━━
_Próximo relatório: amanhã às 06:00 BRT_
```

**Validação contra a planilha** (simulação rodando dia 13/05, referente a 12/05):
- Total Leads: **42** ↔ planilha "Total de Leads": 42,00 ✅
- Total MQLs: **8** ↔ planilha "Total de MQLs": 8,00 ✅
- Conversão: **19,05%** ↔ planilha "Taxa Conv.": 19,05% ✅
- Dias decorridos: **13** ↔ planilha: 13 ✅
- % Atingido Leads acum: **21,54%** ↔ planilha: 21,54% ✅
- % Atingido MQLs acum: **13,68%** ↔ planilha: 13,68% ✅

---

## Diferenças vs EDN7

| Aspecto | EDN7 | GCR |
|---|---|---|
| Spreadsheet | `1CJNL92Ezfq-pPDcL8HDb372xhQfH_OuLSMPpGW9yvjs` | `1PW7-oGks8HT4d-Xb32uQou3KJc86JpQKeY4ogI-LqeM` |
| Aba métricas | gid=1564740833 | gid=1981009125 |
| Campanha | Encontro de Negócios (Antonio Fogaça + Pablo Marçal) | Gestão com Resultado |
| Alvo diário | 30 leads (200 km evento) | 15 leads |
| Cron | `*/7h` (a cada 7 horas) | `0 6 * * *` (diário às 06:00) |
| Mensagem | Snapshot agregado atual | Foco em **ontem** + acumulado até ontem |
| Grupos | "Grupo GERAL - AF" + "GESTÃO DE TRÁFEGO - AF" | A definir após conectar |

---

## Desenvolvimento local

```bash
# Dashboard
cd gcr-dashboard
npm install
npm run dev   # http://localhost:5173

# Worker
cd gcr-whatsapp-worker
cp .env.example .env
# (opcional) edite .env
npm install
node server.js   # http://localhost:3000
```

Para rodar **apenas o teste do parser de métricas** (sem WhatsApp):
```bash
cd gcr-whatsapp-worker
node test/metrics.test.js
```

---

## Estrutura de arquivos

```
gcr-system/
├── README.md                          ← este arquivo
├── gcr-dashboard/
│   ├── index.html                     ← shell HTML + Tailwind CDN + paleta EDN7
│   ├── package.json
│   ├── railway.toml
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                    ← UI: KPI cards, gráfico diário, breakdowns
│       └── lib/sheets.js              ← CSV fetcher + parser
└── gcr-whatsapp-worker/
    ├── server.js                      ← Express + cron + endpoints
    ├── package.json
    ├── railway.toml
    ├── .env.example
    ├── public/index.html              ← UI: status, QR, preview, send-now, logs
    ├── lib/
    │   ├── sheets.js                  ← CSV fetcher + parser
    │   ├── metrics.js                 ← Cálculo do snapshot "ontem"
    │   ├── message.js                 ← Formatter da mensagem
    │   └── whatsapp.js                ← whatsapp-web.js wrapper
    └── test/metrics.test.js           ← Teste E2E do parser + formatter
```
