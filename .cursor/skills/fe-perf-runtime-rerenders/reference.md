# Runtime — advanced patterns

## React.memo

```tsx
const TickerRow = React.memo(function TickerRow({ symbol, price }: Props) {
  return (
    <tr>
      <td>{symbol}</td>
      <td>{price}</td>
    </tr>
  );
});
```

Without Profiler evidence, memo only adds prop comparison overhead.

## useMemo / useCallback

```tsx
const handleSelect = useCallback((id: string) => {
  setSelected(id);
}, []);

const filtered = useMemo(
  () => tickers.filter(t => t.symbol.includes(query)),
  [tickers, query]
);
```

Important: without memo on the child, useCallback only adds overhead.

## WebSocket batching

```tsx
const bufferRef = useRef<Map<string, number>>(new Map());

useEffect(() => {
  const ws = new WebSocket(WS_URL);

  ws.onmessage = (event) => {
    const { symbol, price } = JSON.parse(event.data);
    bufferRef.current.set(symbol, price);
  };

  const interval = setInterval(() => {
    if (bufferRef.current.size === 0) return;
    setTickers(prev => {
      const next = new Map(prev);
      bufferRef.current.forEach((price, symbol) => next.set(symbol, price));
      bufferRef.current.clear();
      return next;
    });
  }, 150);

  return () => { ws.close(); clearInterval(interval); };
}, []);
```
