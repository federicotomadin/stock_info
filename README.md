# Stock Landing (React + Vite)

Landing simple para listar acciones y ordenarlas por rendimiento:

- `1D` (ultimo dia de mercado)
- `1M` (aprox. 21 ruedas bursatiles)
- `1Y` (aprox. 252 ruedas bursatiles)

## Requisitos

- Node.js 20+

## Ejecutar en local

```bash
npm install
npm run dev
```

Para mejorar la precision de perfil de empresa (industry, sector, anos operando), copia variables:

```bash
cp .env.example .env
```

y configura `FINNHUB_API_KEY` con una key gratuita de [Finnhub](https://finnhub.io/).

`npm run dev` levanta:

- frontend Vite en `http://localhost:5173`
- API local en `http://localhost:9001`

## Notas

- La API local construye el universo de acciones desde listados publicos de NASDAQ/NYSE y permite navegarlo con busqueda + paginacion.
- Para precio y variaciones, consulta historicos de [Stooq](https://stooq.com/) y calcula `1D`, `1M` y `1Y`.
- Para perfil corporativo, usa Finnhub como fuente primaria (si hay API key) con fallback a Yahoo/Wikipedia/Wikidata.
- En modo manual se permiten hasta 120 tickers por consulta.

## Newsletter semanal (Top 20)

Requiere `DATABASE_URL` configurada (usa las mismas tablas Postgres del screener).

1. Creá una cuenta en [Resend](https://resend.com/) y generá una API key.
2. En Render, seteá `RESEND_API_KEY`, `NEWSLETTER_FROM_EMAIL` (remitente verificado en Resend),
   `NEWSLETTER_CRON_SECRET` (string random) y `SITE_ORIGIN` (dominio público del sitio).
3. En GitHub → Settings → Secrets/Variables, seteá `API_ORIGIN` (URL de la API en Render) y
   `NEWSLETTER_CRON_SECRET` (mismo valor que en Render).
4. El workflow `.github/workflows/weekly-newsletter.yml` dispara el envío todos los lunes
   (`POST /api/newsletter/send-weekly`), o corrélo manualmente desde la pestaña Actions.

