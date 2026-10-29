-- Progress reports are drafted Friday afternoon and Saturday morning (they were
-- drafted Monday). The app decides which hours act: Friday from 3 PM it drafts
-- each job once its Friday log is in; Saturday at 8 AM it drafts the rest.

select cron.unschedule('onsite-weekly-reports')
where exists (select 1 from cron.job where jobname = 'onsite-weekly-reports');

select cron.schedule(
  'onsite-weekly-reports',
  '15 * * * 5,6',
  $cron$
    select net.http_post(
      url := (select value from public.app_settings where key = 'site_url') || '/api/reports/generate',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-onsite-secret', (select value from public.app_settings where key = 'cron_secret')
      )
    )
  $cron$
);
