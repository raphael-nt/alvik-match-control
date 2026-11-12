
create table public.a2_event(
  id int primary key default 1 check (id=1),
  name text not null default 'Arduino Alvik Smart Logistics Challenge',
  setup_ms int not null default 60000,
  game_ms int not null default 90000,
  field_count int not null default 2 check (field_count between 1 and 4),
  tv_mode text not null default 'auto',
  tv_focus int,
  draw_state jsonb,
  updated_at timestamptz not null default now());
insert into public.a2_event default values;

create table public.a2_secret(
  id int primary key default 1 check (id=1),
  admin_hash text not null, ref_hash text not null);

create table public.a2_team(seed int primary key check (seed between 1 and 9), name text not null default '', updated_at timestamptz not null default now());
insert into public.a2_team(seed) select generate_series(1,9);

create table public.a2_group(grp text primary key, stage text not null, adv int not null, srcs jsonb not null);
insert into public.a2_group values
 ('A','r1',2,'[{"seed":1},{"seed":2},{"seed":3}]'),
 ('B','r1',2,'[{"seed":4},{"seed":5},{"seed":6}]'),
 ('C','r1',2,'[{"seed":7},{"seed":8},{"seed":9}]'),
 ('D','r2',1,'[{"g":"A","p":1},{"g":"C","p":1},{"g":"B","p":2}]'),
 ('E','r2',1,'[{"g":"B","p":1},{"g":"A","p":2},{"g":"C","p":2}]');

create table public.a2_match(
  code text primary key, stage text not null, grp text, order_no int not null, bo int not null,
  red_src jsonb not null, blue_src jsonb not null,
  red_seed int, blue_seed int,
  status text not null default 'locked',
  field_no int, sched_at timestamptz, sched_field int, auto_open boolean not null default false,
  red_wins int not null default 0, blue_wins int not null default 0, winner_seed int,
  updated_at timestamptz not null default now());

insert into public.a2_match(code,stage,grp,order_no,bo,red_src,blue_src)
select g.grp||k, g.stage, g.grp,
  case when g.stage='r1' then (k-1)*3+ascii(g.grp)-64 else 9+(k-1)*2+ascii(g.grp)-67 end, 3,
  g.srcs->(p.a), g.srcs->(p.b)
from public.a2_group g, (values (1,0,1),(2,1,2),(3,0,2)) p(k,a,b), lateral (select p.k) kk(k2)
where p.k=p.k;
-- fix: the above uses p.k; rebuild cleanly
delete from public.a2_match;
insert into public.a2_match(code,stage,grp,order_no,bo,red_src,blue_src)
select g.grp||p.k, g.stage, g.grp,
  case when g.stage='r1' then (p.k-1)*3+(ascii(g.grp)-64) else 9+(p.k-1)*2+(ascii(g.grp)-67) end, 3,
  g.srcs->p.a, g.srcs->p.b
from public.a2_group g cross join (values (1,0,1),(2,1,2),(3,0,2)) p(k,a,b);
insert into public.a2_match(code,stage,grp,order_no,bo,red_src,blue_src)
values ('F','final',null,16,5,'{"g":"D","p":1}','{"g":"E","p":1}');

create table public.a2_game(
  id bigint generated always as identity primary key,
  match_code text not null references public.a2_match(code) on delete cascade,
  idx int not null,
  pattern int check (pattern between 1 and 3),
  status text not null default 'ready',
  need text,
  red_parked int not null default 0 check (red_parked between 0 and 3),
  blue_parked int not null default 0 check (blue_parked between 0 and 3),
  red_full_ms int, blue_full_ms int, red_lift_ms int, blue_lift_ms int, red_exit_ms int, blue_exit_ms int,
  winner text check (winner in ('red','blue')),
  method text, decided_by text, note text,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  unique (match_code, idx));

create table public.a2_field(
  no int primary key check (no between 1 and 4),
  match_code text references public.a2_match(code) on delete set null,
  session uuid, phase text not null default 'idle',
  running boolean not null default false,
  ends_at timestamptz, left_ms int,
  ref_seen timestamptz, updated_at timestamptz not null default now());
insert into public.a2_field(no) select generate_series(1,4);

create table public.a2_fdev(no int primary key references public.a2_field(no) on delete cascade, device text);
insert into public.a2_fdev(no) select generate_series(1,4);

create table public.a2_tiebreak(grp text primary key, seeds int[] not null);
create table public.a2_audit(
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  actor text not null, action text not null, target text, before jsonb, after jsonb, op_id uuid unique);

-- RLS
alter table public.a2_event enable row level security;
alter table public.a2_secret enable row level security;
alter table public.a2_team enable row level security;
alter table public.a2_group enable row level security;
alter table public.a2_match enable row level security;
alter table public.a2_game enable row level security;
alter table public.a2_field enable row level security;
alter table public.a2_fdev enable row level security;
alter table public.a2_tiebreak enable row level security;
alter table public.a2_audit enable row level security;
do $$ declare t text; begin
 foreach t in array array['a2_event','a2_team','a2_group','a2_match','a2_game','a2_field','a2_tiebreak'] loop
  execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t||'_read', t);
 end loop; end $$;
revoke insert,update,delete,truncate on all tables in schema public from anon, authenticated;
alter publication supabase_realtime add table public.a2_event, public.a2_team, public.a2_match, public.a2_game, public.a2_field, public.a2_tiebreak;
