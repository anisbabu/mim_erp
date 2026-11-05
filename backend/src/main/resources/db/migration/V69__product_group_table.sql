-- Product groups become their own table; product points at one by foreign key.

CREATE TABLE product_group (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_product_group_name ON product_group (upper(name));

INSERT INTO product_group (name)
SELECT DISTINCT trim(product_group)
FROM product
WHERE product_group IS NOT NULL AND trim(product_group) <> ''
ON CONFLICT DO NOTHING;

ALTER TABLE product ADD COLUMN product_group_id UUID REFERENCES product_group(id);
CREATE INDEX idx_product_group_id ON product (product_group_id);

UPDATE product p
SET product_group_id = g.id
FROM product_group g
WHERE upper(g.name) = upper(trim(p.product_group));

-- the text column is replaced by the key
ALTER TABLE product DROP COLUMN product_group;
