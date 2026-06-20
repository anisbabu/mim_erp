-- =====================================================================
-- V8 — Delivery address details on the customer, so a driver can find
-- the drop-off easily. Separate from the customer's main/billing address.
-- =====================================================================

ALTER TABLE customer ADD COLUMN delivery_address       VARCHAR(400);
ALTER TABLE customer ADD COLUMN delivery_landmark      VARCHAR(255);
ALTER TABLE customer ADD COLUMN delivery_contact_name  VARCHAR(160);
ALTER TABLE customer ADD COLUMN delivery_contact_phone VARCHAR(40);
ALTER TABLE customer ADD COLUMN delivery_note          VARCHAR(500);
ALTER TABLE customer ADD COLUMN delivery_map_link      VARCHAR(500);
