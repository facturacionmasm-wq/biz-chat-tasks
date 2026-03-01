-- Update cron to run every minute for near-realtime delivery
SELECT cron.unschedule('send-due-reminders');

SELECT cron.schedule(
  'send-due-reminders',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://shcgtvthadhvlxrltmib.supabase.co/functions/v1/send-reminders',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoY2d0dnRoYWRodmx4cmx0bWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjA5NTIsImV4cCI6MjA4Nzc5Njk1Mn0.X08nGU3Wb55Orgg536bDs57td6Ctk8fX310zVB9nDlU"}'::jsonb,
    body:='{"time": "now"}'::jsonb
  ) AS request_id;
  $$
);