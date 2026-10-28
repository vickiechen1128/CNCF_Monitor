-- +goose Up
ALTER TABLE applications ADD COLUMN owner1 TEXT;
ALTER TABLE applications ADD COLUMN owner1_contact TEXT;
ALTER TABLE applications ADD COLUMN owner2 TEXT;
ALTER TABLE applications ADD COLUMN owner2_contact TEXT;
ALTER TABLE applications ADD COLUMN go_live_at DATETIME;

UPDATE applications SET owner1 = owner WHERE (owner1 IS NULL OR owner1 = '') AND owner IS NOT NULL AND owner <> '';

-- +goose Down
ALTER TABLE applications DROP COLUMN go_live_at;
ALTER TABLE applications DROP COLUMN owner2_contact;
ALTER TABLE applications DROP COLUMN owner2;
ALTER TABLE applications DROP COLUMN owner1_contact;
ALTER TABLE applications DROP COLUMN owner1;
