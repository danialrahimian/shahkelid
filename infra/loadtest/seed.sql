-- The load test's shop: 10,000 customers at the size the roadmap names, with
-- a year of history. For a trial server only, NEVER a real one: the script
-- refuses to run on a database that already has customers.
--
--   ./sk psql < ../loadtest/seed.sql   (from infra/production, on the trial stack)
--
-- Each customer has one service (most active, some on hold, expired or out of
-- volume), two thirds have paid orders over the past year, one in ten has a
-- ticket. Subscription links point at the fake panel (fake-panel.mjs), and
-- tokens are "lt" + md5(n), so the load script can find them.

\set ON_ERROR_STOP on
begin;

do $$
begin
  if (select count(*) from users where email not like '%@example.com') > 1 then
    raise exception 'This database has real customers: the load-test seed only runs on a trial server';
  end if;
end $$;

insert into locations (code, name_fa, name_en) values ('DE-LOAD', 'آلمان', 'Germany');

insert into panels (name, driver, base_url, credentials_enc, is_active)
values ('load-test panel', 'pasarguard', 'http://fake-panel:8080', '\x00', false);

insert into plans (slug, name, duration_days, price_toman, data_limit_bytes, device_limit, is_active)
values ('load-monthly-50', 'ماهانه ۵۰ گیگ', 30, 150000, 53687091200, 2, true),
       ('load-quarter-150', 'سه‌ماهه ۱۵۰ گیگ', 90, 390000, 161061273600, 3, true);

insert into servers (panel_id, location_id, name, host, capacity_users, panel_group_id)
select p.id, l.id, 'de-load-1', 'de1.example.com', 20000, 2
from panels p, locations l where p.name = 'load-test panel' and l.code = 'DE-LOAD';

insert into users (email, email_normalized, referral_code, display_name, created_at, last_login_at)
select 'load' || g || '@example.com', 'load' || g || '@example.com', 'LD' || lpad(g::text, 8, '0'),
       'مشتری ' || g, now() - (random() * 365 || ' days')::interval, now() - (random() * 30 || ' days')::interval
from generate_series(1, 10000) g;

-- One service each.
insert into subscriptions (user_id, plan_id, panel_id, server_id, panel_username, access_token,
                           status, data_limit_bytes, used_bytes, expires_at, panel_subscription_url, created_at)
select u.id,
       (select id from plans where slug = case when g % 4 = 0 then 'load-quarter-150' else 'load-monthly-50' end),
       (select id from panels where name = 'load-test panel'),
       (select id from servers where name = 'de-load-1'),
       'sk_load_' || g,
       'lt' || md5(g::text),
       s.status::subscription_status,
       53687091200,
       case s.status when 'limited' then 53687091200 else (random() * 40 * 1073741824)::bigint end,
       case s.status
         when 'on_hold' then null
         when 'expired' then now() - (random() * 60 || ' days')::interval
         else now() + (random() * 30 || ' days')::interval
       end,
       'http://fake-panel:8080/sub/lt' || md5(g::text),
       u.created_at
from generate_series(1, 10000) g
join users u on u.email = 'load' || g || '@example.com'
cross join lateral (select case
    when g % 10 = 0 then 'on_hold'
    when g % 10 = 1 then 'expired'
    when g % 10 = 2 then 'limited'
    else 'active' end as status) s;

-- A year of paid orders: two thirds of customers, one to four each.
insert into orders (user_id, kind, status, subtotal_toman, total_toman, expires_at, paid_at, fulfilled_at, created_at, subscription_id)
select u.id, 'new', 'fulfilled', 150000, 150000, t + interval '1 hour', t, t, t, sub.id
from generate_series(1, 10000) g
join users u on u.email = 'load' || g || '@example.com'
join subscriptions sub on sub.user_id = u.id
cross join lateral generate_series(1, 1 + g % 4) n
cross join lateral (select now() - (random() * 365 || ' days')::interval as t) at
where g % 3 <> 0;

insert into order_items (order_id, plan_id, unit_price_toman, total_toman)
select o.id, (select id from plans where slug = 'load-monthly-50'), o.total_toman, o.total_toman
from orders o join users u on u.id = o.user_id where u.email like 'load%@example.com';

insert into payments (order_id, user_id, method, status, amount_toman, succeeded_at, created_at)
select o.id, o.user_id,
       (array['zarinpal', 'card_transfer', 'usdt_tron'])[1 + (abs(hashtext(o.id::text)) % 3)]::payment_method,
       'succeeded', o.total_toman, o.paid_at, o.paid_at
from orders o join users u on u.id = o.user_id where u.email like 'load%@example.com';

-- One customer in ten has a ticket.
insert into tickets (user_id, subject, status, priority, last_message_at, created_at)
select u.id, 'اتصال کند است ' || g,
       (array['awaiting_staff', 'awaiting_customer', 'resolved', 'closed'])[1 + g % 4]::ticket_status,
       (array['low', 'normal', 'high', 'urgent'])[1 + g % 4]::ticket_priority,
       now() - (random() * 30 || ' days')::interval, now() - (random() * 60 || ' days')::interval
from generate_series(1, 10000, 10) g join users u on u.email = 'load' || g || '@example.com';

insert into ticket_messages (ticket_id, author_user_id, author_kind, body)
select t.id, t.user_id, 'customer', 'از دیشب اتصال خیلی کند شده است.' from tickets t;

commit;

analyze;

select (select count(*) from users) as users,
       (select count(*) from subscriptions) as subscriptions,
       (select count(*) from orders) as orders,
       (select count(*) from tickets) as tickets;
