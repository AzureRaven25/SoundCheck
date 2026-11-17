// Copies the scoring engine into the Edge Functions tree (Supabase bundles only supabase/functions).
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
const header = '// GENERATED from packages/scoring/src/index.ts by `npm run sync:scoring`. Do not edit.\n';
writeFileSync(new URL('../../supabase/functions/_shared/scoring.ts', import.meta.url), header + src);
console.log('synced scoring engine to supabase/functions/_shared/scoring.ts');
