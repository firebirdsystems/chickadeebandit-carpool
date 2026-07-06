# Carpool Coordinator

Organize recurring carpool rotations for school, sports, or activities. Adults create
a rotation (which weekdays, what pickup time, and the driver order), and the app
generates a driving schedule that cycles drivers across the matching days. Members see
who's driving; drivers can request a swap and another adult covers it. Upcoming pickups
are pushed to the **shared family calendar** so the hub can remind drivers.

---

## Data model

| Table | Policy | Notes |
|---|---|---|
| `carpools` | `adult_writable` | Rotation definition. Everyone reads, adults manage. |
| `assignments` | `adult_writable` | One driving day. Generated from the rotation, editable by adults. |
| `swap_requests` | `adult_writable` | A driver asks to be covered; another adult accepts. |

Drivers are adults, so **all write paths are `adult_writable`** — any household adult can
organize, reassign, and resolve swaps, while children (riders) get read-only visibility.

## Calendar integration

The app publishes upcoming assignments to the `calendar_events` KV export (guarded by
`store_acls` so only an adult may write it). The Calendar app aggregates every app's
`calendar_events` under `cross.calendar_events`, so carpool pickups appear there
automatically — no direct write to `family.calendar`.

## Quick start

```bash
npm run dev     # preview at http://localhost:3001
npm run build   # produce dist/bundle.json
npm test        # run manifest + logic tests
```
