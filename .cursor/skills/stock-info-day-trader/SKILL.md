---
name: stock-info-day-trader
description: >-
  Orquesta el agente de trading de stock_info (IBKR, screener, metas diaria/semanal)
  con las herramientas Python de day-trader-skill (noticias, scanner ORB, time machine,
  risk/budget offline). Úsalo al mejorar entradas, vetar trades, revisar riesgo o
  avanzar hacia AGENT_WEEKLY_PROFIT_USD.
---

# stock_info + day-trader-skill

Este repo ya automatiza trades con IBKR (`server/agent/*`). El pack
[day-trader-skill](https://github.com/jakeschincariol/day-trader-skill) vive en
`tools/day-trader-skill/` y complementa ese agente — no lo reemplaza ni usa Alpaca.

## Metas semanales (fuente de verdad)

| Variable | Rol |
| --- | --- |
| `AGENT_WEEKLY_PROFIT_USD` | Deja de **abrir** posiciones si el P&amp;L semanal (lun–dom NY) lo alcanza |
| `AGENT_WEEKLY_LOSS_USD` | Para nuevas entradas si la semana pierde ese tope |
| `AGENT_DAILY_PROFIT_USD` / `AGENT_DAILY_LOSS_USD` | Misma lógica por sesión NY |
| `AGENT_RISK_PCT`, `IBKR_MAX_ORDER_USD`, `IBKR_MAX_ORDERS_PER_DAY` | Tamaño y frecuencia |

La lógica está en `server/agent/dayPlan.ts` y `server/agent/loop.ts`. No dupliques
órdenes con `trader-broker` (Alpaca); ejecución = agente IBKR.

## Sincronizar reglas con las tools Python

```bash
node scripts/sync-trader-config.mjs   # escribe trader/config.json desde .env
```

Requiere Python 3.8+ en el PATH. Para SEC (trader-news, trader-analyst): `SEC_USER_AGENT`
o `TRADER_SEC_USER_AGENT` en `.env`.

## Cuándo usar cada herramienta

| Necesidad | Comando (desde la raíz del repo) |
| --- | --- |
| Titulares antes de operar | `python3 tools/day-trader-skill/trader-news/news.py --tickers SYMBOL --hours 12` |
| Vetar en el agente automático | `AGENT_NEWS_VETO=true` (mismo script vía `server/agent/traderNews.ts`) |
| Scanner intradía (ORB, etc.) | `python3 tools/day-trader-skill/trader-scanner/scan.py orb --at 10:15` |
| Simular odds del setup | `python3 tools/day-trader-skill/trader-timemachine/timemachine.py run --write` |
| Chequeo offline de reglas | `python3 tools/day-trader-skill/trader-risk/check.py` |
| Tests del pack | `python3 -m unittest discover -s tools/day-trader-skill/tests -v` |

Flujo manual recomendado para **una** idea de trade (sin colisionar con el agente):

1. Scanner o screener web → símbolo
2. `trader-news` → evento de riesgo
3. `trader-exit` + `trader-timemachine` → plan y probabilidad
4. Comparar con lo que haría `buildBracketProposal` / panel Agente
5. Solo IBKR manual o dejar que el ciclo automático entre si pasa veto

## Cursor: tareas típicas

- **Subir probabilidad de llegar a la meta semanal**: revisar `AGENT_WEEKLY_*`, reducir
  `AGENT_MAX_POSITIONS` o `IBKR_MAX_ORDERS_PER_DAY`, endurecer veto (`AGENT_AI_VETO`,
  `AGENT_NEWS_VETO`), no relajar stops en código sin medir.
- **Depurar un veto**: leer decisiones en el panel Agente; reproducir noticias con
  `trader-news` para ese ticker.
- **Backtest cualitativo de un setup**: time machine + fixtures en
  `tools/day-trader-skill/tests/fixtures/`.

## Seguridad

- Paper por defecto (`IBKR_ALLOW_LIVE=false`, `AGENT_ALLOW_LIVE=false`).
- Las skills Python **no** envían órdenes; el agente TypeScript sí (con límites).
- Noticias y Yahoo son no oficiales; el precio de IBKR manda al ejecutar.