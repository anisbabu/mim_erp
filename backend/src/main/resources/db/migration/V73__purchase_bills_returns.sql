-- Supplier bill on the goods receipt, landed cost, and purchase returns / debit notes.

-- supplier payment terms: a bill is due this many days after the bill date
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS credit_days INT NOT NULL DEFAULT 0 CHECK (credit_days >= 0);

-- the supplier's own invoice, keyed when the goods arrive or later
ALTER TABLE goods_receipt
    ADD COLUMN IF NOT EXISTS bill_no           VARCHAR(60),
    ADD COLUMN IF NOT EXISTS bill_date         DATE,
    ADD COLUMN IF NOT EXISTS due_date          DATE,
    ADD COLUMN IF NOT EXISTS goods_value       NUMERIC(16,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS freight           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (freight >= 0),
    ADD COLUMN IF NOT EXISTS freight_on_bill   BOOLEAN NOT NULL DEFAULT TRUE,   -- false = paid to a carrier in cash
    ADD COLUMN IF NOT EXISTS price_approved_by VARCHAR(120);

-- billed price per line (may differ from the PO price, with approval) and the landed unit cost
ALTER TABLE grn_line
    ADD COLUMN IF NOT EXISTS unit_price NUMERIC(16,2),
    ADD COLUMN IF NOT EXISTS unit_cost  NUMERIC(16,4);

UPDATE grn_line gl SET unit_price = pl.unit_price, unit_cost = pl.unit_price
FROM po_line pl WHERE pl.id = gl.po_line_id AND gl.unit_price IS NULL;

UPDATE goods_receipt g SET goods_value = coalesce((
    SELECT sum(round(gl.qty_received * gl.unit_price, 2)) FROM grn_line gl WHERE gl.grn_id = g.id), 0),
    due_date = coalesce(due_date, receipt_date);

CREATE TABLE IF NOT EXISTS purchase_return (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_no      VARCHAR(30) NOT NULL UNIQUE,
    debit_note_no  VARCHAR(30) UNIQUE,
    grn_id         UUID NOT NULL REFERENCES goods_receipt(id),
    supplier_id    UUID NOT NULL REFERENCES supplier(id),
    warehouse_id   UUID NOT NULL REFERENCES warehouse(id),
    return_date    DATE NOT NULL,
    reason         VARCHAR(300) NOT NULL,
    settlement     VARCHAR(20) NOT NULL CHECK (settlement IN ('DEBIT_NOTE', 'CASH_REFUND')),
    refund_account VARCHAR(30),
    goods_value    NUMERIC(16,2) NOT NULL CHECK (goods_value >= 0),
    cost_value     NUMERIC(16,2) NOT NULL CHECK (cost_value >= 0),
    created_by     VARCHAR(120),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_return_line (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id      UUID NOT NULL REFERENCES purchase_return(id) ON DELETE CASCADE,
    grn_line_id    UUID NOT NULL REFERENCES grn_line(id),
    product_id     UUID NOT NULL REFERENCES product(id),
    stock_layer_id UUID NOT NULL REFERENCES stock_layer(id),
    qty            NUMERIC(16,2) NOT NULL CHECK (qty > 0),
    unit_price     NUMERIC(16,2) NOT NULL,
    unit_cost      NUMERIC(16,4) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_return_grn ON purchase_return(grn_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_line_grn_line ON purchase_return_line(grn_line_id);

-- goods sent back to the supplier leave stock as their own movement type
ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS chk_move_type;
ALTER TABLE stock_movement ADD CONSTRAINT chk_move_type CHECK (type IN
    ('OPENING','GRN','SALE','DAMAGE','COUNT','TRANSFER_IN','TRANSFER_OUT','SALE_RETURN','PURCHASE_RETURN'));
