-- Maps training slot index → weekday + optional time
-- Format: {"1": {"weekday": 0, "time": "09:00"}, "2": {"weekday": 0, "time": "15:30"}, ...}
-- weekday: 0=Mon, 1=Tue, ..., 6=Sun
-- time: HH:MM string (24h format), null = no specific time
-- When the whole column is null, the week plan is in abstract slot mode
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS day_schedule jsonb DEFAULT NULL;
