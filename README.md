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

`npm run dev` levanta:

- frontend Vite en `http://localhost:5173`
- API local en `http://localhost:9001`

## Notas

- La API local construye el universo de acciones desde listados publicos de NASDAQ/NYSE y permite navegarlo con busqueda + paginacion.
- Para precio y variaciones, consulta historicos de [Stooq](https://stooq.com/) y calcula `1D`, `1M` y `1Y`.
- En modo manual se permiten hasta 120 tickers por consulta.
