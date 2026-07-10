# RUM — web-vitals

```typescript
import { onLCP, onINP, onCLS } from 'web-vitals';

function sendToAnalytics({ name, value, id }: { name: string; value: number; id: string }) {
  fetch('/api/vitals', {
    method: 'POST',
    body: JSON.stringify({ name, value, id }),
  });
}

onLCP(sendToAnalytics);
onINP(sendToAnalytics);
onCLS(sendToAnalytics);
```

## Core Web Vitals

| Metric | What it measures | Good | Poor |
|--------|------------------|------|------|
| LCP | Time until main content appears | < 2.5s | > 4s |
| INP | Interaction latency | < 200ms | > 500ms |
| CLS | Cumulative layout shift | < 0.1 | > 0.25 |
