# Schedule End-Time Plan (55 Minutes)

Status: Draft only. Do not execute until user says to proceed.

## Goal
Add bounded schedule validation so check-in only succeeds when current local time is inside the class window:
- start_time <= now <= end_time

## Fixed Backfill Rule
- Class length for existing rows: 55 minutes

## Scope
- Frontend only (no FastAPI)
- Existing Supabase model:
  - rooms
  - schedule
  - attendance_log

## Step 1: Schema Update
Update schedule table to include end_time.

Planned SQL:
1. Add column end_time time if missing.
2. Backfill null end_time values as start_time + 55 minutes.
3. Set end_time as not null after backfill.
4. Add a safety check constraint ensuring end_time > start_time.
5. Add or update index for student_email + room_beacon_id + start_time + end_time.

## Step 2: Frontend Query Update
In docs/app.js:
1. Keep current room lookup by rooms.beacon_uuid.
2. Update schedule query filters to include both:
   - start_time <= now
   - end_time >= now
3. Keep attendance insert behavior unchanged when schedule passes.

## Step 3: Documentation Update
In README.md:
1. Document schedule columns now required:
   - student_email
   - room_beacon_id
   - start_time
   - end_time
2. Document matching rule:
   - student_email + room_beacon_id + start_time <= now <= end_time
3. Add note about timezone consistency for school schedule data.

## Step 4: Validation
Run after implementation:
1. Syntax check for docs/app.js.
2. Manual scenario tests:
   - Inside window: check-in succeeds.
   - Before start_time: blocked.
   - After end_time: blocked.

## Non-Goals For This Plan
- No threshold+dwell implementation yet.
- No Python/FastAPI handshake API yet.
