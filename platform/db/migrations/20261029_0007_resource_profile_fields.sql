-- +goose Up
ALTER TABLE hosts ADD COLUMN activated_at DATETIME;
ALTER TABLE applications ADD COLUMN ops_person TEXT;
ALTER TABLE applications ADD COLUMN ops_person_contact TEXT;

-- +goose Down
ALTER TABLE applications DROP COLUMN ops_person_contact;
ALTER TABLE applications DROP COLUMN ops_person;
ALTER TABLE hosts DROP COLUMN activated_at;
