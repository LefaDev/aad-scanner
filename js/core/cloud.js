// @ts-check
import { queueCloudScan, getQueuedCloudScans, removeQueuedCloudScan } from './storage.js';

export const SUPABASE_SQL_SETUP = `-- Supabase SQL Setup for AAD 2026 Gate Validator (v1.4 POPIA-Minimised & Multi-Session Safe)
create table if not exists public.gate_scans (
  id             uuid primary key default gen_random_uuid(),
  scanned_at     timestamptz not null default now(),
  ticket_id      text not null check (char_length(ticket_id) between 1 and 128),
  event_id       text check (event_id is null or char_length(event_id) <= 64),
  event_date     date,
  seat_no        integer not null default 1 check (seat_no between 1 and 50),
  holder_name    text check (holder_name is null or char_length(holder_name) <= 180),
  ticket_type    text check (ticket_type is null or char_length(ticket_type) <= 180),
  status         text not null check (status in
                   ('valid','prechecked','duplicate','invalid','cancelled','wrong_event','virtual_denied')),
  gate_name      text check (gate_name is null or char_length(gate_name) <= 80),
  operator       text check (operator is null or char_length(operator) <= 80),
  device_id      text check (device_id is null or char_length(device_id) <= 64),
  raw_payload    text check (raw_payload is null or char_length(raw_payload) <= 512),
  created_at     timestamptz default now()
);

-- Safe migration if upgrading an existing v1.3 table:
alter table public.gate_scans add column if not exists seat_no integer not null default 1;
drop index if exists public.gate_scans_one_admit;

-- Scope duplicate guard by (ticket_id, session, seat_no) so:
--   1. Wednesday Day 3 (aad26-d3) does NOT block Storytelling Dinner (aad26-dinner)
--   2. Multi-seat group bookings (seat 1..N) admit cleanly across gates
create unique index if not exists gate_scans_one_admit_v2
  on public.gate_scans (ticket_id, coalesce(event_id, event_date::text), seat_no)
  where status in ('valid','prechecked');

create index if not exists gate_scans_ticket_idx on public.gate_scans (ticket_id);
create index if not exists gate_scans_event_idx  on public.gate_scans (event_id, event_date, scanned_at desc);

alter table public.gate_scans enable row level security;

-- POPIA Note: Email addresses and security codes are deliberately NEVER written
-- to cloud_scans. Revoke or drop anon policies immediately after 30 Oct 2026.
drop policy if exists "gate insert" on public.gate_scans;
create policy "gate insert" on public.gate_scans
  for insert to anon
  with check (
    char_length(ticket_id) between 1 and 128
    and status in ('valid','prechecked','duplicate','invalid','cancelled','wrong_event','virtual_denied')
  );

drop policy if exists "gate read" on public.gate_scans;
create policy "gate read" on public.gate_scans
  for select to anon
  using (event_date >= '2026-10-24' and event_date <= '2026-11-02');
`;

/** @type {Promise<void>|null} */
let activeFlushPromise = null;

/**
 * Build Supabase request headers
 * @param {string} anonKey 
 * @returns {Record<string, string>}
 */
function getHeaders(anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal'
  };
}

/**
 * Sanitise & minimise PII in outbound cloud payload (POPIA data minimisation).
 * Never sends delegate emails or ticket security_code secrets to public anon tables.
 * @param {Record<string, any>} row
 */
export function sanitizeCloudRow(row) {
  return {
    ticket_id: String(row.ticket_id || '').slice(0, 128),
    event_id: row.event_id ? String(row.event_id).slice(0, 64) : null,
    event_date: row.event_date || null,
    seat_no: Math.max(1, Math.min(50, Number(row.seat_no) || 1)),
    holder_name: row.holder_name ? String(row.holder_name).slice(0, 180) : null,
    ticket_type: row.ticket_type ? String(row.ticket_type).slice(0, 180) : null,
    status: row.status,
    gate_name: row.gate_name ? String(row.gate_name).slice(0, 80) : null,
    operator: row.operator ? String(row.operator).slice(0, 80) : null,
    device_id: row.device_id ? String(row.device_id).slice(0, 64) : null,
    raw_payload: row.raw_payload ? String(row.raw_payload).slice(0, 512) : null
  };
}

/**
 * Test Supabase connection
 * @param {string} url 
 * @param {string} anonKey 
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function testConnection(url, anonKey) {
  if (!url || !anonKey) {
    return { success: false, message: 'URL and Anon Key are required.' };
  }
  try {
    const cleanUrl = url.replace(/\/+$/, '');
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== 'https:') {
      return { success: false, message: 'Supabase URL must use HTTPS.' };
    }
    const res = await fetch(`${cleanUrl}/rest/v1/gate_scans?select=count&limit=1`, {
      method: 'GET',
      headers: getHeaders(anonKey)
    });
    if (res.ok) {
      return { success: true, message: 'Connected successfully to Supabase.' };
    }
    const errText = await res.text();
    return { success: false, message: `Supabase returned ${res.status}: ${errText.slice(0, 100)}` };
  } catch (err) {
    return { success: false, message: 'Connection failed: ' + err.message };
  }
}

/**
 * Fetch active session's admits from Supabase for cross-device duplicate detection.
 * Filters by `event_id` when provided (preventing Day 3 vs Dinner collisions).
 *
 * @param {string} url 
 * @param {string} anonKey 
 * @param {string} date YYYY-MM-DD
 * @param {string} [eventId]
 * @returns {Promise<Array<{ ticket_id: string, event_id?: string, gate_name: string, scanned_at: string }>>}
 */
export async function fetchRemoteAdmits(url, anonKey, date, eventId) {
  if (!url || !anonKey || (!date && !eventId)) return [];
  try {
    const cleanUrl = url.replace(/\/+$/, '');
    const filter = eventId
      ? `event_id=eq.${encodeURIComponent(eventId)}`
      : `event_date=eq.${encodeURIComponent(date)}`;
    const res = await fetch(
      `${cleanUrl}/rest/v1/gate_scans?select=ticket_id,event_id,gate_name,scanned_at&${filter}&status=in.(valid,prechecked)`,
      { headers: getHeaders(anonKey) }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch remote admits:', err);
    return [];
  }
}

/**
 * Push a scan record to cloud queue and attempt flush
 * @param {any} row 
 * @param {{ cloudSync: boolean, supabaseUrl: string, supabaseAnonKey: string }} settings 
 * @param {(conflictTicketId: string) => void} [onRaceConditionLost]
 */
export async function recordCloudScan(row, settings, onRaceConditionLost) {
  if (!settings.cloudSync || !settings.supabaseUrl || !settings.supabaseAnonKey) {
    return;
  }

  await queueCloudScan(sanitizeCloudRow(row));
  flushCloudQueue(settings, onRaceConditionLost).catch(() => {});
}

/**
 * Flush all pending queued cloud scans (serialised to prevent duplicate POST races)
 * @param {{ supabaseUrl: string, supabaseAnonKey: string }} settings 
 * @param {(conflictTicketId: string) => void} [onRaceConditionLost]
 */
export async function flushCloudQueue(settings, onRaceConditionLost) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;

  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    const queue = await getQueuedCloudScans();
    if (queue.length === 0) return;

    const cleanUrl = settings.supabaseUrl.replace(/\/+$/, '');
    const headers = getHeaders(settings.supabaseAnonKey);

    for (const item of queue) {
      const { id, ...payload } = item;
      try {
        let res = await fetch(`${cleanUrl}/rest/v1/gate_scans`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        // Graceful fallback if the remote v1.3 table hasn't added `seat_no` yet
        if (res.status === 400 && 'seat_no' in payload) {
          const errBody = await res.clone().text();
          if (errBody.includes('seat_no') || errBody.includes('PGRST204')) {
            const { seat_no: _omit, ...legacyPayload } = payload;
            res = await fetch(`${cleanUrl}/rest/v1/gate_scans`, {
              method: 'POST',
              headers,
              body: JSON.stringify(legacyPayload)
            });
          }
        }

        if (res.status === 201 || res.status === 200 || res.status === 204) {
          await removeQueuedCloudScan(id);
        } else if (res.status === 409) {
          await removeQueuedCloudScan(id);
          if (typeof onRaceConditionLost === 'function' && payload.ticket_id) {
            onRaceConditionLost(payload.ticket_id);
          }
        } else {
          const body = await res.text();
          if (body.includes('23505')) {
            await removeQueuedCloudScan(id);
            if (typeof onRaceConditionLost === 'function' && payload.ticket_id) {
              onRaceConditionLost(payload.ticket_id);
            }
          }
          break;
        }
      } catch (_) {
        break;
      }
    }
  })().finally(() => {
    activeFlushPromise = null;
  });

  return activeFlushPromise;
}
