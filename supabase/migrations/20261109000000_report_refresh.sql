-- Progress reports stay open Friday 10 AM to Monday noon, and drafts nobody has
-- edited now refresh whenever that week's daily logs change, so Saturday and
-- Sunday logs get pulled in on their own. The drafting job therefore runs
-- hourly Friday through Monday (it was Friday and Saturday only). The app
-- decides what each run does; outside the window it does nothing.

select cron.unschedule('onsite-weekly-reports')
where exists (select 1 from cron.job where jobname = 'onsite-weekly-reports');

select cron.schedule(
  'onsite-weekly-reports',
  '15 * * * 0,1,5,6',
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
