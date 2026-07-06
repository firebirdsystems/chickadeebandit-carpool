SELECT
  a.driver_id,
  COUNT(*) AS upcoming_drives
FROM app_carpool__assignments a
WHERE a.date >= date('now') AND a.status = 'scheduled' AND a.driver_id != ''
GROUP BY a.driver_id
ORDER BY upcoming_drives DESC
LIMIT 100
