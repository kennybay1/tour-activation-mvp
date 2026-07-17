-- Tour Activation — funnel reports
--
-- How to use: open the Supabase SQL editor, paste ONE query at a time,
-- change the slug in the "params" line at the top of the query, and Run.
-- The funnel_summary view at the bottom only needs to be run once.


-- ============================================================
-- 1) Funnel summary — one row for a single campaign
--    (edit the slug in the params line)
-- ============================================================
with params as (
  select 'testband-london'::text as slug
),
c as (
  select id from campaigns where slug = (select slug from params)
),
ev as (
  select * from events where campaign_id in (select id from c)
),
cl as (
  select * from claims where campaign_id in (select id from c)
)
select
  (select count(distinct session_id) from ev where event_type = 'page_view')          as page_views,
  (select count(distinct session_id) from ev where event_type = 'permission_granted') as permission_granted,
  round(
    100.0 * (select count(distinct session_id) from ev where event_type = 'permission_granted')
          / nullif((select count(distinct session_id) from ev where event_type = 'page_view'), 0),
    1)                                                                                 as grant_rate_pct,
  (select count(distinct session_id) from ev where event_type = 'permission_denied')  as permission_denied,
  (select count(*) from cl)                                                           as registrations,
  (select count(*) from cl where unlocked)                                            as unlocks,
  (select count(*) from ev where event_type = 'unlock_out_of_range')                  as out_of_range_attempts,
  (select count(distinct session_id) from ev where event_type = 'ticket_click')       as ticket_clicks,
  round(
    100.0 * (select count(distinct session_id) from ev where event_type = 'ticket_click')
          / nullif((select count(*) from cl where unlocked), 0),
    1)                                                                                 as unlock_to_click_rate_pct;


-- ============================================================
-- 2) High intent, didn't make it — registered but never unlocked
-- ============================================================
with params as (
  select 'testband-london'::text as slug
)
select
  cl.email,
  cl.marketing_consent,
  cl.consent_at,
  cl.distance_m       as last_distance_m,
  cl.created_at       as registered_at
from claims cl
join campaigns c on c.id = cl.campaign_id
where c.slug = (select slug from params)
  and not cl.unlocked
order by cl.created_at desc;


-- ============================================================
-- 3) Unlock attempts by hour of day (UK time — change the
--    time zone if the campaign runs elsewhere)
-- ============================================================
with params as (
  select 'testband-london'::text as slug
)
select
  extract(hour from e.created_at at time zone 'Europe/London')::int as hour_of_day,
  count(*) filter (where e.event_type = 'claim_attempt')       as attempts,
  count(*) filter (where e.event_type = 'unlock_success')      as successes,
  count(*) filter (where e.event_type = 'unlock_out_of_range') as out_of_range
from events e
join campaigns c on c.id = e.campaign_id
where c.slug = (select slug from params)
  and e.event_type in ('claim_attempt', 'unlock_success', 'unlock_out_of_range')
group by 1
order by 1;


-- ============================================================
-- 4) Consented contacts export — safe to hand to a mailing tool
-- ============================================================
with params as (
  select 'testband-london'::text as slug
)
select
  cl.email,
  cl.consent_at,
  cl.unlocked,
  (cl.ticket_clicked_at is not null) as ticket_clicked
from claims cl
join campaigns c on c.id = cl.campaign_id
where c.slug = (select slug from params)
  and cl.marketing_consent
order by cl.consent_at;


-- ============================================================
-- funnel_summary view — run ONCE, then browse it in the
-- Supabase table editor (one row per campaign)
-- ============================================================
create or replace view funnel_summary as
with ev as (
  select
    campaign_id,
    count(distinct session_id) filter (where event_type = 'page_view')          as page_views,
    count(distinct session_id) filter (where event_type = 'permission_granted') as permission_granted,
    count(distinct session_id) filter (where event_type = 'permission_denied')  as permission_denied,
    count(*)                   filter (where event_type = 'unlock_out_of_range') as out_of_range_attempts,
    count(distinct session_id) filter (where event_type = 'ticket_click')       as ticket_clicks
  from events
  group by campaign_id
),
cl as (
  select
    campaign_id,
    count(*)                          as registrations,
    count(*) filter (where unlocked)  as unlocks
  from claims
  group by campaign_id
)
select
  c.slug,
  c.artist_name,
  c.title,
  coalesce(ev.page_views, 0)            as page_views,
  coalesce(ev.permission_granted, 0)    as permission_granted,
  round(100.0 * coalesce(ev.permission_granted, 0) / nullif(ev.page_views, 0), 1) as grant_rate_pct,
  coalesce(ev.permission_denied, 0)     as permission_denied,
  coalesce(cl.registrations, 0)         as registrations,
  coalesce(cl.unlocks, 0)               as unlocks,
  coalesce(ev.out_of_range_attempts, 0) as out_of_range_attempts,
  coalesce(ev.ticket_clicks, 0)         as ticket_clicks,
  round(100.0 * coalesce(ev.ticket_clicks, 0) / nullif(cl.unlocks, 0), 1)         as unlock_to_click_rate_pct
from campaigns c
left join ev on ev.campaign_id = c.id
left join cl on cl.campaign_id = c.id;

-- Keep the view out of the public API — dashboard/service access only.
revoke select on funnel_summary from anon, authenticated;
