-- =====================================================================
-- V79 - Supplier bills (accounts payable), separate from the goods receipt.
--   GRN            Dr Inventory (+ Input VAT)  / Cr 2010 Goods received, not billed
--   SUPPLIER BILL  Dr 2010 (GRN value)         / Cr Supplier ledger (billed amount), difference to 5000
--   PAYMENT        Dr Supplier / Cr Cash-Bank   (unchanged)
-- A PO is CLOSED only when every line is received, every receipt is billed and every bill is settled.
-- Receipts posted before V79 credited the supplier directly: they get a LEGACY bill that points at
-- their own GRN journal, so nothing is re-posted and the books stay as they are.
-- =====================================================================

INSERT INTO account (code, name, name_bn, type, group_id, is_system)
SELECT '2010', 'Goods received, not billed', 'প্রাপ্ত পণ্য, বিল আসেনি', 'LIABILITY',
       (SELECT id FROM account_group WHERE code = 'L-CL'), true
WHERE NOT EXISTS (SELECT 1 FROM account WHERE code = '2010');

CREATE TABLE supplier_bill (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_no             VARCHAR(30)   NOT NULL UNIQUE,          -- our number, SB-yyyy-nnnnnn
    supplier_id         UUID          NOT NULL REFERENCES supplier(id),
    po_id               UUID          NOT NULL REFERENCES purchase_order(id),
    supplier_invoice_no VARCHAR(60),                            -- the supplier's own invoice no.
    bill_date           DATE          NOT NULL,
    due_date            DATE          NOT NULL,
    grn_value           NUMERIC(16,2) NOT NULL DEFAULT 0,       -- cleared from 2010
    total               NUMERIC(16,2) NOT NULL,                 -- owed to the supplier
    variance            NUMERIC(16,2) NOT NULL DEFAULT 0,       -- total - grn_value, to 5000
    status              VARCHAR(12)   NOT NULL DEFAULT 'POSTED',
    legacy              BOOLEAN       NOT NULL DEFAULT FALSE,   -- receipt posted to the supplier before V79
    journal_id          UUID REFERENCES journal_entry(id),
    note                VARCHAR(255),
    created_by          VARCHAR(60),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    cancelled_at        TIMESTAMPTZ,
    cancel_reason       VARCHAR(255),
    CONSTRAINT chk_sbill_status CHECK (status IN ('POSTED','CANCELLED')),
    CONSTRAINT chk_sbill_total  CHECK (total >= 0)
);
CREATE INDEX idx_sbill_supplier ON supplier_bill(supplier_id, bill_date);
CREATE INDEX idx_sbill_po ON supplier_bill(po_id);

CREATE TABLE supplier_bill_line (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id        UUID          NOT NULL REFERENCES supplier_bill(id) ON DELETE CASCADE,
    grn_id         UUID          NOT NULL REFERENCES goods_receipt(id),
    grn_value      NUMERIC(16,2) NOT NULL,
    billed_amount  NUMERIC(16,2) NOT NULL CHECK (billed_amount >= 0)
);
CREATE INDEX idx_sbill_line_grn ON supplier_bill_line(grn_id);
CREATE INDEX idx_sbill_line_bill ON supplier_bill_line(bill_id);

-- a return before the bill reduces what is still to be billed (Dr 2010) instead of the supplier
ALTER TABLE purchase_return ADD COLUMN IF NOT EXISTS against_grni BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- legacy: every receipt that already credited the supplier counts as billed ----
INSERT INTO supplier_bill (bill_no, supplier_id, po_id, supplier_invoice_no, bill_date, due_date,
                           grn_value, total, variance, status, legacy, journal_id, created_by)
SELECT 'LB-' || g.grn_no, po.supplier_id, po.id, g.bill_no,
       coalesce(g.bill_date, g.receipt_date), coalesce(g.due_date, g.bill_date, g.receipt_date),
       g.goods_value + CASE WHEN g.freight_on_bill THEN g.freight ELSE 0 END,
       g.goods_value + CASE WHEN g.freight_on_bill THEN g.freight ELSE 0 END,
       0, 'POSTED', true,
       (SELECT je.id FROM journal_entry je WHERE je.source_type = 'GRN' AND je.source_id = g.id
        ORDER BY je.created_at LIMIT 1),
       'system'
FROM goods_receipt g JOIN purchase_order po ON po.id = g.po_id
WHERE g.goods_value + CASE WHEN g.freight_on_bill THEN g.freight ELSE 0 END > 0;

INSERT INTO supplier_bill_line (bill_id, grn_id, grn_value, billed_amount)
SELECT b.id, g.id, b.total, b.total
FROM supplier_bill b JOIN goods_receipt g ON 'LB-' || g.grn_no = b.bill_no
WHERE b.legacy;

-- ---- reporting views ----
-- what each receipt still has to be billed for, and its posted bill (if any)
CREATE VIEW grn_billing AS
SELECT g.id AS grn_id, g.po_id,
       g.goods_value + CASE WHEN g.freight_on_bill THEN g.freight ELSE 0 END
         - coalesce((SELECT sum(r.goods_value) FROM purchase_return r WHERE r.grn_id = g.id AND r.against_grni), 0) AS to_bill,
       (SELECT bl.bill_id FROM supplier_bill_line bl JOIN supplier_bill b ON b.id = bl.bill_id
        WHERE bl.grn_id = g.id AND b.status = 'POSTED' LIMIT 1) AS bill_id
FROM goods_receipt g;

-- each posted bill with its open amount in the supplier's bill-wise ledger
CREATE VIEW supplier_bill_open AS
SELECT b.id AS bill_id, b.po_id, b.supplier_id,
       coalesce(sum(i.amount), 0) AS amount,
       coalesce(sum(i.amount - coalesce((SELECT sum(x.amount) FROM bill_allocation x
                                          WHERE x.bill_id = i.id OR x.credit_id = i.id), 0)), 0) AS open_amount
FROM supplier_bill b
LEFT JOIN party_item i ON i.kind = 'BILL' AND (
        (i.source_type = 'SUPPLIER_BILL' AND i.source_id = b.id)
     OR (b.legacy AND i.source_type = 'GRN' AND i.source_id IN (SELECT grn_id FROM supplier_bill_line WHERE bill_id = b.id)))
WHERE b.status = 'POSTED'
GROUP BY b.id, b.po_id, b.supplier_id;

-- receipt / billing / payment progress of every PO
CREATE VIEW po_progress AS
SELECT p.id AS po_id, p.supplier_id, p.status,
       CASE WHEN bool_and(l.qty_balance = l.qty_ordered) THEN 'PENDING'
            WHEN bool_and(l.qty_balance = 0) THEN 'DONE' ELSE 'PARTIAL' END AS receipt_status,
       coalesce((SELECT sum(gb.to_bill) FROM grn_billing gb
                 WHERE gb.po_id = p.id AND gb.bill_id IS NULL AND gb.to_bill > 0), 0) AS unbilled,
       coalesce((SELECT sum(o.amount) FROM supplier_bill_open o WHERE o.po_id = p.id), 0) AS billed,
       coalesce((SELECT sum(o.open_amount) FROM supplier_bill_open o WHERE o.po_id = p.id), 0) AS remaining
FROM purchase_order p JOIN po_line l ON l.po_id = p.id
GROUP BY p.id, p.supplier_id, p.status;
