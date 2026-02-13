export const REALTIME_CHANNELS = {
  broadcastRefresh: {
    GROUP: "broadcast-refresh-group",
    KNOCKOUT: "broadcast-refresh-knockout",
  },
  schedule: {
    GROUP: "schedule-auto-group",
    KNOCKOUT: "schedule-auto-knockout",
  },
} as const;

export const REALTIME_EVENTS = {
  BROADCAST_REFRESH_REQUIRED: "refresh_required",
  SCHEDULE_MATCH_COMPLETED: "match_completed",
} as const;
