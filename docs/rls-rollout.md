# RLS Rollout Checklist

## 1) Baseline Audit (Dev)

```sql
-- Exposed tables and RLS status
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Current policies
select schemaname, tablename, policyname, cmd, roles, permissive, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## 2) Apply Migration

Run Prisma migration in dev first:

```bash
npx prisma migrate dev
```

Migration file:
- `prisma/migrations/20260212133000_enable_rls_broadcast_policies/migration.sql`

## 3) Post-Apply Verification

```sql
-- RLS should be ON for all public tables
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Only these tables should have anon SELECT policies
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and roles @> ARRAY['anon']::name[]
order by tablename, policyname;
```

Expected anon policy tables:
- `CourtAssignment`
- `BlockedMatch`
- `Match`
- `KnockoutMatch`
- `ScheduleConfig`

## 4) App Validation (Dev)

1. Open `/broadcast` and verify live updates still arrive when schedule changes.
2. As admin, verify schedule/matches/referee/utilities mutations still work.
3. As viewer/public client, verify direct table writes are blocked.

## 5) Production Rollout

1. Apply the same migration in production during low traffic.
2. Repeat post-apply verification SQL.
3. Smoke test:
- `/broadcast` live updates
- `/schedule` admin operations
- `/referee` submit flow
- `/utilities` actions

## Notes

- This migration intentionally allows **anon SELECT only** on broadcast-related tables.
- No anon insert/update/delete policies are created.
