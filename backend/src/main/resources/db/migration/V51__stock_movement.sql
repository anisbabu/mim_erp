-- =====================================================================
-- V51 — Stock movement ledger: one append-only row per stock change.
-- stock_layer keeps current on-hand + FIFO cost; this table keeps the
-- history needed for opening / inward / outward / closing reports.
-- qty is signed: + for stock in, - for stock out.
-- =====================================================================

CREATE TABLE stock_movement (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    move_date      DATE NOT NULL,
    product_id     UUID NOT NULL REFERENCES product(id),
    warehouse_id   UUID NOT NULL REFERENCES warehouse(id),
    qty            NUMERIC(16,2) NOT NULL CHECK (qty <> 0),
    unit_cost      NUMERIC(16,4) NOT NULL,
    type           VARCHAR(20) NOT NULL,
    ref_id         UUID,                                -- GRN / challan / adjustment id
    stock_layer_id UUID REFERENCES stock_layer(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_move_type CHECK (type IN
        ('OPENING','GRN','SALE','DAMAGE','COUNT','TRANSFER_IN','TRANSFER_OUT'))
);
CREATE INDEX idx_move_prod_wh_date ON stock_movement(product_id, warehouse_id, move_date);
CREATE INDEX idx_move_date ON stock_movement(move_date);
