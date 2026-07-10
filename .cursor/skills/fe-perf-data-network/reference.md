# Data & network — reference

## .NET analogy

TanStack Query ≈ `IMemoryCache` + Polly retry + declarative invalidation, on the client side tied to component lifecycle.

## Infinite scroll

```tsx
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['tickers', filters],
  queryFn: ({ pageParam }) => fetchTickers({ cursor: pageParam }),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  initialPageParam: undefined,
});
```

Combine with `@tanstack/react-virtual` to keep the DOM small.

## Mutations — optimistic updates

```tsx
const mutation = useMutation({
  mutationFn: updateTicker,
  onMutate: async (newData) => {
    await queryClient.cancelQueries({ queryKey: ['ticker', symbol] });
    const previous = queryClient.getQueryData(['ticker', symbol]);
    queryClient.setQueryData(['ticker', symbol], newData);
    return { previous };
  },
  onError: (_err, _newData, context) => {
    queryClient.setQueryData(['ticker', symbol], context?.previous);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['ticker', symbol] });
  },
});
```
