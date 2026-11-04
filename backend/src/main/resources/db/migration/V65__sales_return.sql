-- Sales returns / credit notes. A return restores stock to the FIFO layer the goods came from
-- and reverses revenue, cost of sales and the customer receivable.
ALTER TABLE stock_movement DROP CONSTRAINT chk_move_type;
ALTER TABLE stock_movement ADD CONSTRAINT chk_move_type CHECK (type IN
    ('OPENING','GRN','SALE','DAMAGE','COUNT','TRANSFER_IN','TRANSFER_OUT','SALE_RETURN'));

CREATE TABLE sales_return (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_no      VARCHAR(30) NOT NULL UNIQUE,
    credit_note_no VARCHAR(30) UNIQUE,                 -- set when settled by credit note
    so_id          UUID NOT NULL REFERENCES sales_order(id),
    customer_id    UUID NOT NULL REFERENCES customer(id),
    shop_id        UUID REFERENCES shop(id),
    return_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    reason         VARCHAR(255) NOT NULL,
    settlement     VARCHAR(12) NOT NULL,               -- CREDIT_NOTE | CASH_REFUND
    goods_value    NUMERIC(16,2) NOT NULL,             -- reverses revenue / receivable
    cost_value     NUMERIC(16,2) NOT NULL,             -- reverses cost of sales / restores inventory
    created_by     VARCHAR(120),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ret_settlement CHECK (settlement IN ('CREDIT_NOTE','CASH_REFUND'))
);
CREATE INDEX idx_sales_return_so ON sales_return(so_id);
CREATE INDEX idx_sales_return_customer ON sales_return(customer_id);

CREATE TABLE sales_return_line (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id      UUID NOT NULL REFERENCES sales_return(id) ON DELETE CASCADE,
    dc_line_id     UUID NOT NULL REFERENCES dc_line(id),
    product_id     UUID NOT NULL REFERENCES product(id),
    warehouse_id   UUID NOT NULL REFERENCES warehouse(id),
    stock_layer_id UUID REFERENCES stock_layer(id),
    qty            NUMERIC(16,2) NOT NULL CHECK (qty > 0),
    unit_price     NUMERIC(16,4) NOT NULL,             -- net of discount, as invoiced
    unit_cost      NUMERIC(16,4) NOT NULL
);
CREATE INDEX idx_sales_return_line_dc ON sales_return_line(dc_line_id);
