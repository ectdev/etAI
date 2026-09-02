-- Runs automatically the first time the container starts with an empty data
-- directory. Keeping it here means a fresh clone gets a working database from
-- `docker compose up` alone.
CREATE EXTENSION IF NOT EXISTS vector;
