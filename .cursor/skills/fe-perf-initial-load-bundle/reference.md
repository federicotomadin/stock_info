# Bundle — reference

## Analyze bundle (Vite)

```bash
npm i -D rollup-plugin-visualizer
```

```typescript
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({ open: true, gzipSize: true }),
  ],
});
```

## Typical findings

| Dependency | Problem | Alternative |
|------------|---------|-------------|
| moment.js (~290kb) | Size + full locales | date-fns or dayjs (~7kb) |
| full lodash (~70kb) | Import 3 functions, get everything | lodash-es named imports |
| Chart/UI libraries | Used in one component | lazy load at point of use |
| react-icons | Full icon sets | Verify bundler tree shaking |

## Tree shaking — silent killers

```typescript
// ❌ Kills tree shaking
import _ from 'lodash';
_.debounce(fn, 300);

// ✅ Named ESM import
import { debounce } from 'lodash-es';

// ✅ Direct module import
import debounce from 'lodash/debounce';
```

## Vendor chunks

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-query': ['@tanstack/react-query'],
      },
    },
  },
},
```

Hash in filename → browser caches chunks that didn't change between deploys.
