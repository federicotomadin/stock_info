---
name: fe-perf-runtime-rerenders
description: >-
  Optimize React re-renders: state colocation, children composition, granular
  selectors, list virtualization, debounce/deferredValue, WebSocket batching.
  Use when UI feels slow on typing/scroll/click, INP is high, or Profiler shows
  unnecessary re-renders. Apply memo/useMemo/useCallback only as last resort.
---

# 2. Runtime — Re-renders

The #1 cause of React slowness: components re-rendering unnecessarily.

**Rule:** `memo` / `useMemo` / `useCallback` are the **last resort**. Fix state architecture first.

## Priority order

1. State architecture (placement, subscription granularity)
2. Long list virtualization
3. Debounce / deferred updates on inputs
4. `memo` / `useMemo` / `useCallback` — only where the Profiler justifies it

## State colocation

Keep state as close as possible to where it's used.

```tsx
// ❌ One keystroke at the root re-renders the entire tree
function App() {
  const [search, setSearch] = useState('');
  return (
    <>
      <SearchInput value={search} onChange={setSearch} />
      <HeavyDashboard />
    </>
  );
}

// ✅ State lives in the component that needs it
function SearchBar() {
  const [search, setSearch] = useState('');
  return <SearchInput value={search} onChange={setSearch} />;
}
```

## Composition with children

Passing content as `children` avoids re-renders — React reuses the same element:

```tsx
function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div>
      <Sidebar open={sidebarOpen} />
      {children}
    </div>
  );
}
```

## Granular selectors (Zustand / Redux)

```tsx
// ❌ Every store change re-renders this component
const store = useStore();

// ✅ Only subscribes to the slice it needs
const price = useStore(s => s.tickers[symbol]?.price);
```

Critical with real-time WebSockets: if every tick updates a global object, everything subscribed re-renders.

## Long lists — virtualization

Rendering 5000 rows is suicide. Render only the ~30 visible with `react-window` or `@tanstack/react-virtual`.

## High-frequency inputs

For search, sliders, filters: debounce, throttle, `useDeferredValue`, or `useTransition` (React 18).

```tsx
const [query, setQuery] = useState('');
const deferredQuery = useDeferredValue(query);

const filtered = useMemo(
  () => heavyFilter(tickers, deferredQuery),
  [tickers, deferredQuery]
);
```

## WebSockets — batching

Accumulate ticks and update every 100–250ms, not per message.

See [reference.md](reference.md) for `React.memo`, `useCallback`, and WebSocket batching.

## memo / useMemo / useCallback

- `React.memo`: only where the Profiler shows it hurts
- `useCallback` / `useMemo`: stabilize refs for memoized children
- **Without memo on the child, useCallback only adds overhead**
