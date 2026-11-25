-- Keep the catalog-search function warm: a cold start added ~3 s to the first search after a quiet spell. A no-op
-- ping every 5 minutes (~8,600 invocations a month, well within the free tier). Uses the project URL in Vault;
-- does nothing where it's absent (local development).
select cron.schedule('keep-search-warm', '*/5 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/catalog-search',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"warm": true}'::jsonb,
    timeout_milliseconds := 10000)
  where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
$job$);
