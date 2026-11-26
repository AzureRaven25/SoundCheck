-- New releases: every Monday, add Apple Music's 100 most-played US songs to the catalog (or rank them up), so
-- what people are listening to now is always searchable and on the genre pages. No-op where project_url is
-- absent (local development).
select cron.schedule('weekly-charts', '0 6 * * 1', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/catalog-search',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"action": "charts"}'::jsonb,
    timeout_milliseconds := 120000)
  where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
$job$);
