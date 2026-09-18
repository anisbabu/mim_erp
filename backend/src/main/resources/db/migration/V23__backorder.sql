-- =====================================================================
-- V23 — Backorder support: a sales order line can be invoiced before
-- stock exists. qty_pending tracks the not-yet-delivered portion,
-- reduced as the line is fulfilled (possibly across several restocks).
-- =====================================================================

ALTER TABLE so_line ADD COLUMN qty_pending NUMERIC(16,2) NOT NULL DEFAULT 0;
