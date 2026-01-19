# Tournament Genie

Admin-first web app to manage badminton doubles tournaments with clear rules and manual control.

## Tech Stack

- Next.js (TypeScript, App Router)
- Tailwind CSS
- shadcn/ui
- Prisma + Supabase (Postgres) in later milestones

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file using the example:

```bash
cp .env.example .env
```

3. Update `DATABASE_URL` and `DIRECT_URL` with your Supabase Postgres values.

2. Run the dev server:

```bash
npm run dev
```

3. Open `http://localhost:3000`.

## Database & Prisma

1. Generate the Prisma client:

```bash
npx prisma generate
```

2. Create the initial migration (requires a reachable database):

```bash
npx prisma migrate dev --name init
```

3. Verify connectivity:

```bash
curl http://localhost:3000/api/health/db
```

## Project Structure

- `src/app`: Next.js routes and layouts
- `src/components/ui`: shadcn/ui components

## Milestones

- M1: Project scaffold, Tailwind, shadcn/ui, navigation shell
- M2: Prisma + Supabase setup, schema, DB health check
- M3: Players CRUD
- M4: Teams CRUD + seed flags
- M5: Groups + randomization
- M6: Group matches, standings (wins, point diff, head-to-head, random draw), and group stage lock
- M7: Series A/B split from final group standings and knockout bracket seeding
- M8: Knockout matches, score entry, walkovers, and second-chance logic (optional)