SELECT
  a.id,
  a.carpool_id,
  a.date,
  a.driver_id,
  a.status,
  a.note,
  c.name AS carpool_name,
  c.pickup_time,
  c.location
FROM app_carpool__assignments a
JOIN app_carpool__carpools c
  ON c.id = a.carpool_id AND c.archived = 0
WHERE a.date >= date('now') AND a.status = 'scheduled'
ORDER BY a.date ASC
LIMIT 200
