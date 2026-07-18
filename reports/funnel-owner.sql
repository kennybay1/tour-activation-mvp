-- Organiser-facing funnel view — run ONCE in the Supabase SQL editor.
--
-- security_invoker makes Postgres apply row-level security as the QUERYING
-- user, so each organiser only ever sees aggregates for campaigns they own.
-- The platform's own funnel_summary view (service-role only) is unchanged.

create or replace view funnel_summary_owner
with (security_invoker = true) as
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
  c.id as campaign_id,
  c.slug,
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

grant select on funnel_summary_owner to authenticated;
revoke select on funnel_summary_owner from anon;
