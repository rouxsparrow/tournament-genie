# Speed Insights Monitoring Runbook

## Scope
This runbook defines production monitoring expectations for standings category switches.

## Required dimensions
Use these dimensions in Vercel Speed Insights dashboards/filters:

- **Route**: `/standings`
- **Category query**: `category=MD`, `category=WD`, `category=XD`
- **Device type**: mobile and desktop

## Healthy thresholds (category switches on `/standings`)
Track Web Vitals p75 and p95 for production traffic segmented by the dimensions above.

- **INP (interaction latency)**
  - Healthy: p75 <= **200ms** and p95 <= **350ms**
  - Investigate: p75 > 200ms or p95 > 350ms
- **LCP (visual response after route/category load)**
  - Healthy: p75 <= **2.5s** and p95 <= **4.0s**
  - Investigate: p75 > 2.5s or p95 > 4.0s
- **CLS (layout stability during switch)**
  - Healthy: p75 <= **0.10** and p95 <= **0.20**
  - Investigate: p75 > 0.10 or p95 > 0.20

## Ownership and escalation
- **Primary investigator**: on-call frontend engineer.
- **Secondary investigator**: platform/on-call full-stack engineer if issue persists > 1 hour or impacts multiple categories/devices.
- **Escalate to**: tournament operations lead when sustained degradation affects live event operations.

## Triage checklist
1. Confirm the regression appears in production only (not preview) and isolate affected category/device.
2. Compare MD/WD/XD and mobile/desktop to identify a specific segment.
3. Check recent deploys and feature flags touching standings data fetch, table rendering, or navigation transitions.
4. If p95 remains above threshold for 30+ minutes, open incident and rollback or hotfix.


## Deployment and production verification
1. Deploy main branch to production in Vercel.
2. Generate real traffic by opening `/standings` and switching category between MD/WD/XD on both mobile and desktop.
3. In Vercel > Speed Insights, filter by:
   - route `/standings`
   - each query value (`category=MD`, `category=WD`, `category=XD`)
   - each device type (mobile, desktop)
4. Confirm metrics populate for those segments before closing the rollout task.
