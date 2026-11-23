-- =====================================================================
-- V80 - Customer invoices (receivables) and sales order payment progress.
-- The delivery is the invoice: each delivery / day-end invoice already raises a BILL item in the
-- customer's bill-wise ledger (party_item). These views read them per invoice and per sales order.
-- A sales order is CLOSED once everything is delivered and every invoice on it is settled
-- (SoStatusService); it goes back to DELIVERED / INVOICED if a receipt match is undone.
-- =====================================================================

-- every customer invoice (and opening balance) with what is still open
CREATE VIEW customer_invoice AS
SELECT i.id AS item_id, i.party_id AS customer_id, i.source_type, i.source_id, i.doc_no, i.doc_date, i.due_date,
       i.amount,
       i.amount - coalesce((SELECT sum(x.amount) FROM bill_allocation x WHERE x.bill_id = i.id), 0) AS open_amount,
       coalesce(so.id, dcso.id) AS so_id,
       coalesce(so.so_no, dcso.so_no) AS so_no,
       dc.dc_no
FROM party_item i
LEFT JOIN sales_order so ON i.source_type IN ('SALES_DELIVERY', 'SALES_INVOICE') AND so.id = i.source_id
LEFT JOIN delivery_challan dc ON i.source_type = 'SALES_DELIVERY' AND dc.id = i.source_id
LEFT JOIN sales_order dcso ON dcso.id = dc.so_id
WHERE i.party_type = 'CUSTOMER' AND i.kind = 'BILL';

-- delivery / invoice / payment progress of every sales order
CREATE VIEW so_progress AS
SELECT s.id AS so_id, s.customer_id, s.status, s.workflow, s.payment_mode,
       CASE WHEN bool_and(l.qty_pending = 0) THEN 'DONE'
            WHEN bool_and(l.qty_pending = l.qty) THEN 'PENDING' ELSE 'PARTIAL' END AS delivery_status,
       coalesce((SELECT sum(ci.amount) FROM customer_invoice ci WHERE ci.so_id = s.id), 0) AS invoiced,
       coalesce((SELECT sum(ci.open_amount) FROM customer_invoice ci WHERE ci.so_id = s.id), 0) AS remaining
FROM sales_order s JOIN so_line l ON l.so_id = s.id
GROUP BY s.id, s.customer_id, s.status, s.workflow, s.payment_mode;
