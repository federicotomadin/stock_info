---
name: buffett-agent-guardrails
description: >-
  Aplica los 12 tenets de The Warren Buffett Way al agente IBKR de stock_info:
  fundamentales FMP en veto, reglas duras ROE/deuda/margen, círculo de competencia
  por sector, disciplina Mr. Market en el ranking del screener. Úsalo al tunear
  entradas, vetos o metas semanales sin convertir el bot en buy-and-hold.
---

# Buffett guardrails (agente táctico)

El agente sigue siendo **swing/intradía** con meta semanal. Buffett aquí es **filtro de calidad y psicología**, no horizonte infinito.

## Variables `.env`

| Variable | Default | Efecto |
| --- | --- | --- |
| `AGENT_BUFFETT_FUNDAMENTALS` | `true` (si ≠ `false`) | FMP/Finnhub en `veto.ts` |
| `AGENT_BUFFETT_HARD_RULES` | `true` | Bloqueo duro ROE / deuda / margen |
| `AGENT_BUFFETT_MIN_ROE` | `8` | % mínimo ROE TTM si hay dato |
| `AGENT_BUFFETT_MAX_DEBT_EQUITY` | `2.5` | Máximo apalancamiento |
| `AGENT_BUFFETT_MIN_NET_MARGIN` | `0` | Margen neto TTM mínimo |
| `AGENT_MR_MARKET_DISCIPLINE` | `true` | Ranking en `scan.ts` |
| `AGENT_BLOCKED_TICKERS` | — | `TSLA,XYZ` |
| `AGENT_BLOCKED_SECTORS` | — | `real estate` |
| `AGENT_ALLOWED_SECTORS` | — | Si se define, whitelist de sectores |

Requiere `FMP_API_KEY` (o Finnhub como fallback) para fundamentales.

## Código

| Archivo | Rol |
| --- | --- |
| `server/agent/buffettGuard.ts` | Reglas duras + Mr. Market boost |
| `server/agent/fundamentalsBrief.ts` | Resumen para IA |
| `server/agent/veto.ts` | Orden: bloqueados → fundamentales → IA |
| `server/agent/scan.ts` | `rankScore` con disciplina Mr. Market |

## Tenets cubiertos

- **Negocio (1–3):** círculo de competencia, sectores bloqueados
- **Financiero (7–9):** ROE, margen, deuda en veto
- **Valor (11–12):** DCF vs precio solo informativo en prompt (no bloqueo automático)
- **Mr. Market:** menos peso a Momentum con RSI/mes extendidos; más a Pullback bounce en RSI 35–55

## No hace (a propósito)

- No calcula valor intrínseco completo ni exige holding años
- No reemplaza `dayPlan` ni metas semanales
- Sin datos fundamentales → **no** bloquea por ROE (evita falsos negativos)

## Tunear para meta semanal

- Subir `AGENT_BUFFETT_MIN_ROE` y endurecer hard rules → menos trades, más calidad
- `AGENT_MR_MARKET_DISCIPLINE=false` → screener más agresivo (más riesgo de chase)
- Combinar con `AGENT_NEWS_VETO=true` para earnings/noticias + fundamentales