<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# EcoHorta Inteligente — regras do projeto

- UI text in Brazilian Portuguese; code, identifiers and commits in English.
- Never present simulated data as real. Anything with `origin: "simulation"` must be visibly marked (SIMULAÇÃO).
- Screens read collectors only through `CollectorDataSource` (`src/lib/iot/data-source.ts`); never hardcode a collector code such as EC-001 in components.
- A mission is completed by the volume **measured** by the sensor, never by commanded volume or valve-open time.
- The output valve is not chosen yet (gravity-fed system): do not assume a specific valve model. See `docs/HARDWARE.md`.
- No credentials in code. Add new variables to `.env.example` and the README table.
- Mobile-first (360–412 px). Run `npm run check` before committing.
