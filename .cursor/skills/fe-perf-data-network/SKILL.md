---
name: fe-perf-data-network
description: >-
  Optimize React data and network: TanStack Query cache/deduplication, pagination,
  infinite scroll, WebSocket batching, prefetch on navigation. Use when there
  are duplicate fetches, large datasets, real-time feeds, or server state in useState.
---

# 4. Data & Network

Optimizations when the bottleneck is fetches, large datasets, or real-time streams.

## TanStack Query — server state

Server state is not like UI state — it's async, can be stale, and is shared across components.

**Don't reinvent** loading/error/cache/refetch with `useState` + `useEffect`.

```tsx
function TickerDetail({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ticker', symbol],
    queryFn: () => fetch(`/api/tickers/${symbol}`).then(r => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMsg />;
  return <Chart data={data} />;
}
```

### What you get for free

| Feature | Description |
|---------|-------------|
| Cache by queryKey | Two components request `['ticker', 'AAPL']` → one fetch |
| Deduplication | 10 simultaneous mounts = 1 request |
| Stale-while-revalidate | Show cache instantly, refetch in background |
| Invalidation | `queryClient.invalidateQueries({ queryKey: ['tickers'] })` |

## Pagination vs full datasets

Don't fetch 10,000 records if the user sees 50:

- Classic pagination — offset/limit or **cursor** (prefer cursor when data changes between requests)
- Infinite scroll — `useInfiniteQuery` + `IntersectionObserver`
- Combo: infinite scroll + virtualization (`@tanstack/react-virtual`)

## WebSockets — batching

```tsx
// ❌ 100 ticks/sec = 100 setState/sec
ws.onmessage = (e) => setPrice(JSON.parse(e.data));

// ✅ Batch every 150ms — see fe-perf-runtime-rerenders/reference.md
```

Combine with granular Zustand selectors so only affected rows re-render.

## Prefetch on navigation

Preload chunk + data in parallel when intent is detected:

```tsx
function NavLink({ to, queryKey, queryFn, children }) {
  const queryClient = useQueryClient();
  const loadPage = () => import(`./pages/${to}`);

  return (
    <Link
      to={to}
      onMouseEnter={() => {
        loadPage();
        queryClient.prefetchQuery({ queryKey, queryFn });
      }}
    >
      {children}
    </Link>
  );
}
```

## Checklist

- [ ] Duplicate fetches that TanStack Query would deduplicate?
- [ ] `staleTime` set according to data freshness needs?
- [ ] Large lists using pagination or infinite scroll?
- [ ] WebSockets batching before touching React state?
- [ ] Infinite scroll + virtualization when accumulating thousands of items?

See [reference.md](reference.md) for mutations and infinite scroll.
