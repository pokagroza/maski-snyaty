-- Галерея вечеров: фотографии хранятся прямо в базе, поэтому попадают в ежедневный резервный дамп вместе со всем остальным
CREATE TABLE gallery_photos (
  id           serial PRIMARY KEY,
  caption      text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 140),
  taken_on     date,
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image        bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 3145728),
  width        integer NOT NULL CHECK (width BETWEEN 1 AND 6000),
  height       integer NOT NULL CHECK (height BETWEEN 1 AND 6000),
  sort         integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_by   integer REFERENCES staff (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gallery_photos_order_idx ON gallery_photos (sort DESC, taken_on DESC NULLS LAST, id DESC);
