-- Index the manifest `preload` read, which the hub runs server-side while
-- rendering this app's document — on every launch, for every household.
--
-- preload.swap_requests reads only the open ones but had to visit every swap
-- request ever raised to find them. `status` is plaintext at rest, so the
-- filter becomes a seek: SEARCH ... (status=?).
CREATE INDEX IF NOT EXISTS app_carpool__swap_requests_status_idx
  ON app_carpool__swap_requests (status);
