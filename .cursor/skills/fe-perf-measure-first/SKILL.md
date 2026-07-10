---
name: fe-perf-measure-first
description: >-
  Measure before optimizing React: Profiler, Chrome Performance, Lighthouse,
  Web Vitals, and RUM with web-vitals. Use before any performance optimization,
  when diagnosing slow load vs slow interactions, or setting LCP/INP/CLS baselines.
---

# 1. Measure First

Before touching code, you need data. Optimizing without measuring is the classic trap.

## Two problem families

| Family | Symptoms | Go to |
|--------|----------|-------|
| Slow initial load | Blank screen, high LCP | `fe-perf-initial-load-bundle` |
| Slow interactions | Typing lag, scroll jank, high INP | `fe-perf-runtime-rerenders` |
| Network / data | Duplicate requests, huge lists | `fe-perf-data-network` |

## Tools

### React DevTools Profiler
- Record an interaction → which components re-render, how often, and why
- Enable **"Record why each component rendered"**
- Useful when the app feels slow on typing, scrolling, or clicking

### Chrome DevTools → Performance
- Long tasks (> 50ms block the main thread)
- Layout thrashing (alternating DOM reads/writes)
- Scripting vs rendering vs painting

### Lighthouse / Web Vitals

| Metric | Problem it indicates |
|--------|---------------------|
| LCP | Large bundle, slow hero image, no SSR |
| INP | Re-renders, heavy handlers, blocked main thread |
| CLS | Images without dimensions, content injected above |

Run Lighthouse in incognito with network/CPU throttling.

### Production — RUM (web-vitals)

Lab (Lighthouse) and field (RUM) often diverge — **trust RUM for prioritization**.

See [reference.md](reference.md) for the `web-vitals` snippet.

## Checklist before optimizing

- [ ] Did you reproduce the issue with Profiler or Performance tab?
- [ ] Do you know if it's initial load or interaction?
- [ ] Do you have a baseline (LCP, INP, CLS) before the change?
- [ ] Will you measure again after the change?
