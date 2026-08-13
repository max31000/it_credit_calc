ALTER TABLE mortgages
    ADD COLUMN used_property_base DECIMAL(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN used_interest_base DECIMAL(15,2) NOT NULL DEFAULT 0
