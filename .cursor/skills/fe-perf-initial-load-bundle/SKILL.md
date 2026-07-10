---
name: fe-perf-initial-load-bundle
description: >-
  Optimize React initial load: code splitting lazy/Suspense, bundle analysis
  with rollup-plugin-visualizer, tree shaking, vendor chunks, image optimization,
  SSR/SSG. Use when LCP is slow, blank screen on first visit, or bundle is large.
---

# 3. Initial Load — Bundle

The user pays the cost of **ALL** your code on the first visit, even if they only use 10%.

## Process (impact order)

1. `rollup-plugin-visualizer` → find the 20% that weighs 80%
2. Split by route with `lazy` + `Suspense`
3. Replace the 2–3 heaviest dependencies
4. Split heavy features (charts, editors, PDF) at point of use
5. Vendor chunks for long-term caching
6. Images: dimensions + formats + lazy
7. Lighthouse before/after

## Code splitting — Level 1: by route

Maximum impact. Start here.

```tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Screener  = lazy(() => import('./pages/Screener'));

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/screener" element={<Screener />} />
      </Routes>
    </Suspense>
  );
}
```

## Level 2: by heavy feature

```tsx
const ChartModal = lazy(() => import('./components/ChartModal'));

function TickerRow({ symbol }: { symbol: string }) {
  const [showChart, setShowChart] = useState(false);
  return (
    <>
      <button onClick={() => setShowChart(true)}>View chart</button>
      {showChart && (
        <Suspense fallback={<Spinner />}>
          <ChartModal symbol={symbol} />
        </Suspense>
      )}
    </>
  );
}
```

## Preloading on navigation

```tsx
const loadDashboard = () => import('./pages/Dashboard');
const Dashboard = lazy(loadDashboard);

<Link to="/dashboard" onMouseEnter={loadDashboard}>Dashboard</Link>
```

Combine with TanStack Query: on hover, preload chunk and data in parallel.

## Tree shaking

- Named ESM imports, not `import _ from 'lodash'`
- Avoid barrel files (`index.ts` that re-exports everything)
- Verify `"sideEffects": false` on dependencies

## Images (CLS + LCP)

```tsx
<img
  src="/chart-preview.webp"
  width={800}
  height={450}
  loading="lazy"
  decoding="async"
  alt="Preview"
/>
```

- WebP/AVIF: 30–60% smaller than equivalent JPEG/PNG
- `loading="lazy"`: below the fold — **never** on the LCP image
- Preload LCP: `<link rel="preload" as="image" href="...">`

## SSR / SSG

If LCP is still poor after bundle + images → Next.js or preload critical resources.

See [reference.md](reference.md) for visualizer, vendor chunks, and typical findings.
