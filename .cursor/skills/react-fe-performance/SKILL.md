---
name: react-fe-performance
description: >-
  React front-end performance guide: measure first, diagnose, then optimize.
  Use when writing or reviewing React/TSX code, optimizing performance, LCP, INP,
  CLS, re-renders, bundle size, code splitting, TanStack Query, or WebSockets.
---

# React Front-end Performance

Index of specialized skills. Read the skill that matches the symptom before generating code.

| # | Skill | When |
|---|-------|------|
| 1 | [fe-perf-measure-first](../fe-perf-measure-first/SKILL.md) | Always — before touching code |
| 2 | [fe-perf-runtime-rerenders](../fe-perf-runtime-rerenders/SKILL.md) | App slow on interaction |
| 3 | [fe-perf-initial-load-bundle](../fe-perf-initial-load-bundle/SKILL.md) | Slow initial load / LCP |
| 4 | [fe-perf-data-network](../fe-perf-data-network/SKILL.md) | Fetches, large datasets, streams |

## Mental map

```
React Performance
├── 1. MEASURE FIRST → Profiler, Performance tab, Lighthouse, RUM
├── 2. RUNTIME → state, memo (last), virtualization, debounce
├── 3. INITIAL LOAD → lazy/Suspense, visualizer, tree shaking, images
└── 4. DATA & NETWORK → TanStack Query, pagination, WebSocket batching
```

## Typical combo for data feeds

Infinite scroll (`useInfiniteQuery`) + virtualization (`@tanstack/react-virtual`): load pages but keep the DOM small.
