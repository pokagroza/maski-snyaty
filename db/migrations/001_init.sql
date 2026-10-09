-- «Маски сняты»: начальная схема базы данных
-- Форматы: msk — московская (спортивная) мафия, spb — питерская.

CREATE TYPE game_format    AS ENUM ('msk', 'spb');
CREATE TYPE game_result    AS ENUM ('red', 'black', 'maniac', 'draw');
CREATE TYPE seat_role      AS ENUM ('civ', 'sher', 'doc', 'lover', 'maniac', 'maf', 'don');
CREATE TYPE dq_kind        AS ENUM ('none', 'dq', 'ppk');
CREATE TYPE staff_role     AS ENUM ('admin', 'host');
CREATE TYPE event_kind     AS ENUM ('msk', 'spb', 'novice', 'theme', 'final');
CREATE TYPE request_kind   AS ENUM ('event', 'subscription', 'corporate', 'private');
CREATE TYPE booking_status AS ENUM ('new', 'confirmed', 'attended', 'no_show', 'cancelled');

-- Сотрудники: администраторы и ведущие
CREATE TABLE staff (
  id             serial PRIMARY KEY,
  login          text NOT NULL,
  display_name   text NOT NULL,
  password_hash  text NOT NULL,
  role           staff_role NOT NULL DEFAULT 'host',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  CONSTRAINT staff_login_format CHECK (login ~ '^[a-z0-9_.-]{3,32}$'),
  CONSTRAINT staff_name_len CHECK (char_length(display_name) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX staff_login_uq ON staff (login);

-- Сессии входа в админку (храним только хеш токена)
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  staff_id    integer NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Игроки клуба. Протоколы ссылаются на id, поэтому смена ника не ломает историю.
CREATE TABLE players (
  id          serial PRIMARY KEY,
  nick        text NOT NULL,
  nick_key    text GENERATED ALWAYS AS (lower(btrim(nick))) STORED,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT players_nick_len CHECK (char_length(btrim(nick)) BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX players_nick_key_uq ON players (nick_key);

-- Афиша
CREATE TABLE events (
  id            serial PRIMARY KEY,
  kind          event_kind NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  starts_at     timestamptz NOT NULL,
  venue         text NOT NULL DEFAULT 'Зал LUPIN',
  price         integer NOT NULL,
  capacity      integer NOT NULL,
  table_size    smallint NOT NULL DEFAULT 10,
  is_spectator  boolean NOT NULL DEFAULT false,
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_title_len CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT events_price_ok CHECK (price BETWEEN 0 AND 1000000),
  CONSTRAINT events_capacity_ok CHECK (capacity BETWEEN 1 AND 500),
  CONSTRAINT events_table_ok CHECK (table_size BETWEEN 8 AND 14)
);
CREATE INDEX events_starts_idx ON events (starts_at);

-- Заявки с сайта (запись на игру, абонемент, корпоратив, частная игра)
CREATE TABLE bookings (
  id            serial PRIMARY KEY,
  request_kind  request_kind NOT NULL DEFAULT 'event',
  event_id      integer REFERENCES events (id) ON DELETE RESTRICT,
  name          text NOT NULL,
  contact       text NOT NULL,
  seats         smallint NOT NULL DEFAULT 1,
  comment       text NOT NULL DEFAULT '',
  status        booking_status NOT NULL DEFAULT 'new',
  consent_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  handled_by    integer REFERENCES staff (id) ON DELETE SET NULL,
  CONSTRAINT bookings_event_needed CHECK ((request_kind = 'event') = (event_id IS NOT NULL)),
  CONSTRAINT bookings_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT bookings_contact_len CHECK (char_length(contact) BETWEEN 3 AND 80),
  CONSTRAINT bookings_seats_ok CHECK (seats BETWEEN 1 AND 6),
  CONSTRAINT bookings_comment_len CHECK (char_length(comment) <= 500)
);
CREATE INDEX bookings_event_idx ON bookings (event_id);
CREATE INDEX bookings_status_idx ON bookings (status, created_at DESC);

-- Протокол игры (один стол, одна партия)
CREATE TABLE games (
  id          serial PRIMARY KEY,
  event_id    integer REFERENCES events (id) ON DELETE SET NULL,
  format      game_format NOT NULL,
  played_on   date NOT NULL,
  table_no    smallint NOT NULL DEFAULT 1,
  host_name   text NOT NULL DEFAULT '',
  result      game_result NOT NULL,
  lx1         smallint,
  lx2         smallint,
  lx3         smallint,
  created_by  integer REFERENCES staff (id) ON DELETE SET NULL,
  updated_by  integer REFERENCES staff (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT games_table_ok CHECK (table_no BETWEEN 1 AND 20),
  CONSTRAINT games_maniac_spb CHECK (result <> 'maniac' OR format = 'spb'),
  CONSTRAINT games_lx_all_or_none CHECK ((lx1 IS NULL AND lx2 IS NULL AND lx3 IS NULL) OR (lx1 IS NOT NULL AND lx2 IS NOT NULL AND lx3 IS NOT NULL)),
  CONSTRAINT games_lx_range CHECK (lx1 IS NULL OR (lx1 BETWEEN 1 AND 14 AND lx2 BETWEEN 1 AND 14 AND lx3 BETWEEN 1 AND 14)),
  CONSTRAINT games_lx_distinct CHECK (lx1 IS NULL OR (lx1 <> lx2 AND lx2 <> lx3 AND lx1 <> lx3)),
  CONSTRAINT games_lx_msk_only CHECK (lx1 IS NULL OR format = 'msk'),
  CONSTRAINT games_host_len CHECK (char_length(host_name) <= 60)
);
CREATE INDEX games_month_idx ON games (format, played_on);

-- Места за столом
CREATE TABLE game_seats (
  game_id       integer NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seat_no       smallint NOT NULL,
  player_id     integer NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  role          seat_role NOT NULL,
  dop           numeric(3, 2) NOT NULL DEFAULT 0,
  fines         smallint NOT NULL DEFAULT 0,
  dq            dq_kind NOT NULL DEFAULT 'none',
  first_killed  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (game_id, seat_no),
  CONSTRAINT seats_no_ok CHECK (seat_no BETWEEN 1 AND 14),
  CONSTRAINT seats_dop_ok CHECK (dop >= 0 AND dop <= 0.7),
  CONSTRAINT seats_fines_ok CHECK (fines BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX game_seats_player_uq ON game_seats (game_id, player_id);
CREATE UNIQUE INDEX game_seats_one_first_uq ON game_seats (game_id) WHERE first_killed;
CREATE INDEX game_seats_player_idx ON game_seats (player_id);

-- Журнал действий сотрудников
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  staff_id   integer REFERENCES staff (id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  integer,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Команда роли: red — город, black — мафия, solo — маньяк
CREATE FUNCTION role_team(r seat_role) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN r IN ('maf', 'don') THEN 'black' WHEN r = 'maniac' THEN 'solo' ELSE 'red' END
$$;

CREATE FUNCTION seat_won(r seat_role, res game_result) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN res = 'draw' THEN false
    WHEN res = 'maniac' THEN r = 'maniac'
    ELSE role_team(r) = res::text
  END
$$;

-- Полная проверка протокола. Вызывается в конце транзакции,
-- поэтому протокол можно записывать по частям (игра, затем места).
CREATE FUNCTION validate_game(gid integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  g        games%ROWTYPE;
  n        integer;
  max_no   integer;
  c_civ    integer; c_sher integer; c_maf integer; c_don integer; c_black integer; c_maniac integer;
  dop_sum  numeric;
  bad      integer;
  first_no integer;
  first_role seat_role;
BEGIN
  SELECT * INTO g FROM games WHERE id = gid;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), max(seat_no),
         count(*) FILTER (WHERE role = 'civ'), count(*) FILTER (WHERE role = 'sher'),
         count(*) FILTER (WHERE role = 'maf'), count(*) FILTER (WHERE role = 'don'),
         count(*) FILTER (WHERE role_team(role) = 'black'), count(*) FILTER (WHERE role = 'maniac'),
         coalesce(sum(dop), 0)
    INTO n, max_no, c_civ, c_sher, c_maf, c_don, c_black, c_maniac, dop_sum
    FROM game_seats WHERE game_id = gid;

  IF n = 0 THEN RAISE EXCEPTION 'game %: no seats', gid USING ERRCODE = 'check_violation'; END IF;
  IF max_no <> n THEN RAISE EXCEPTION 'game %: seat numbers must be 1..%', gid, n USING ERRCODE = 'check_violation'; END IF;

  IF g.format = 'msk' THEN
    IF n <> 10 OR c_civ <> 6 OR c_sher <> 1 OR c_maf <> 2 OR c_don <> 1 THEN
      RAISE EXCEPTION 'game %: msk table must be 6 civ, 1 sher, 2 maf, 1 don', gid USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF n < 8 OR n > 14 THEN RAISE EXCEPTION 'game %: spb table must have 8..14 seats', gid USING ERRCODE = 'check_violation'; END IF;
    IF c_black < 1 THEN RAISE EXCEPTION 'game %: spb table needs mafia', gid USING ERRCODE = 'check_violation'; END IF;
    IF c_maniac > 1 THEN RAISE EXCEPTION 'game %: only one maniac allowed', gid USING ERRCODE = 'check_violation'; END IF;
    IF g.result = 'maniac' AND c_maniac = 0 THEN RAISE EXCEPTION 'game %: maniac win without maniac', gid USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF dop_sum > 1.2 THEN RAISE EXCEPTION 'game %: dop sum exceeds 1.2', gid USING ERRCODE = 'check_violation'; END IF;
  IF g.result = 'draw' AND dop_sum > 0 THEN RAISE EXCEPTION 'game %: no dop on draw', gid USING ERRCODE = 'check_violation'; END IF;

  SELECT count(*) INTO bad FROM game_seats
   WHERE game_id = gid AND dop > 0.4 AND NOT seat_won(role, g.result);
  IF bad > 0 THEN RAISE EXCEPTION 'game %: losers may get at most 0.4 dop', gid USING ERRCODE = 'check_violation'; END IF;

  SELECT seat_no, role INTO first_no, first_role FROM game_seats WHERE game_id = gid AND first_killed;
  IF g.lx1 IS NOT NULL THEN
    IF first_no IS NULL OR role_team(first_role) <> 'red' THEN
      RAISE EXCEPTION 'game %: best move needs a red first-killed player', gid USING ERRCODE = 'check_violation';
    END IF;
    IF greatest(g.lx1, g.lx2, g.lx3) > n OR first_no IN (g.lx1, g.lx2, g.lx3) THEN
      RAISE EXCEPTION 'game %: best move seats are invalid', gid USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END
$$;

CREATE FUNCTION trg_validate_game() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'games' THEN
    PERFORM validate_game(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM validate_game(OLD.game_id);
  ELSE
    PERFORM validate_game(NEW.game_id);
    IF TG_OP = 'UPDATE' AND OLD.game_id <> NEW.game_id THEN PERFORM validate_game(OLD.game_id); END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER games_validate
  AFTER INSERT OR UPDATE ON games
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_validate_game();

CREATE CONSTRAINT TRIGGER game_seats_validate
  AFTER INSERT OR UPDATE OR DELETE ON game_seats
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_validate_game();
