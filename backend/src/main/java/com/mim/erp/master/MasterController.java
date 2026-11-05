package com.mim.erp.master;

import com.mim.erp.common.ApiException;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/master")
public class MasterController {

    private final ProductRepository products;
    private final WarehouseRepository warehouses;
    private final SupplierRepository suppliers;
    private final SupplierGroupRepository supplierGroups;
    private final ShopRepository shops;
    private final CustomerRepository customers;
    private final JdbcTemplate jdbc;
    private final ProductGroupRepository productGroups;

    public MasterController(ProductRepository products, WarehouseRepository warehouses,
                            SupplierRepository suppliers, SupplierGroupRepository supplierGroups,
                            ShopRepository shops, CustomerRepository customers, JdbcTemplate jdbc,
                            ProductGroupRepository productGroups) {
        this.productGroups = productGroups;
        this.jdbc = jdbc;
        this.products = products; this.warehouses = warehouses;
        this.suppliers = suppliers; this.supplierGroups = supplierGroups;
        this.shops = shops; this.customers = customers;
    }

    // ---- reads ----
    @GetMapping("/products")   @Cacheable(value = MasterCache.NAME, key = "'products'")   public List<Product>   products()   { return products.findAllByOrderByCreatedAtDesc(); }
    @GetMapping("/warehouses") @Cacheable(value = MasterCache.NAME, key = "'warehouses'") public List<Warehouse> warehouses() { return warehouses.findAll(); }
    @GetMapping("/suppliers")  @Cacheable(value = MasterCache.NAME, key = "'suppliers'")  public List<Supplier>  suppliers()  { return suppliers.findAll(); }
    @GetMapping("/product-groups") @Cacheable(value = MasterCache.NAME, key = "'product-groups'") public List<ProductGroup> productGroups() { return productGroups.findAllByOrderByNameAsc(); }
    @GetMapping("/supplier-groups") @Cacheable(value = MasterCache.NAME, key = "'supplier-groups'") public List<SupplierGroup> supplierGroups() { return supplierGroups.findAll(); }
    @GetMapping("/shops")      @Cacheable(value = MasterCache.NAME, key = "'shops'")      public List<Shop>      shops()      { return shops.findAll(); }
    @GetMapping("/customers")  @Cacheable(value = MasterCache.NAME, key = "'customers'")  public List<Customer>  customers()  { return customers.findAll(); }

    // ---- create ----
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/products")
    public Product saveProduct(@RequestBody Product p) {
        checkBand(p.getPriceLower(), p.getPriceUpper());
        Product saved = products.save(p);
        auditBand(saved.getId(), null, null, saved.getPriceLower(), saved.getPriceUpper());
        return saved;
    }
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/suppliers")
    public Supplier saveSupplier(@RequestBody Supplier s) {
        if (s.getCode() == null || s.getCode().isBlank()) s.setCode(nextSupplierCode());
        return suppliers.save(s);
    }

    private static final Pattern SUPPLIER_CODE = Pattern.compile("^SUP-(\\d+)$");
    private String nextSupplierCode() {
        int max = 0;
        for (Supplier s : suppliers.findAll()) {
            if (s.getCode() == null) continue;
            Matcher m = SUPPLIER_CODE.matcher(s.getCode());
            if (m.matches()) max = Math.max(max, Integer.parseInt(m.group(1)));
        }
        return String.format("SUP-%04d", max + 1);
    }
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/supplier-groups") public SupplierGroup saveSupplierGroup(@RequestBody SupplierGroup g) { return supplierGroups.save(g); }
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/customers") public Customer  saveCustomer(@RequestBody Customer c) {
        if ("PARTY".equals(c.getType()) && c.getCreditLimit() == null)
            throw new ApiException("Party customers need a credit limit");
        return customers.save(c);
    }
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/warehouses") public Warehouse saveWarehouse(@RequestBody Warehouse w) { w.setName(upper(w.getName())); return warehouses.save(w); }
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/shops")      public Shop      saveShop(@RequestBody Shop s)           { checkShopAmounts(s); return shops.save(s); }

    /** Add a product group; a name that already exists (any case) returns the existing one. */
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PostMapping("/product-groups")
    public ProductGroup saveProductGroup(@RequestBody ProductGroup in) {
        String name = upper(in.getName());
        if (name == null || name.isBlank()) throw new ApiException("Group name is required");
        if (name.length() > 100) throw new ApiException("Group name is too long (max 100 characters)");
        return productGroups.findByNameIgnoreCase(name).orElseGet(() -> {
            ProductGroup g = new ProductGroup();
            g.setName(name);
            return productGroups.save(g);
        });
    }

    private static String upper(String s) { return s == null ? null : s.trim().toUpperCase(Locale.ROOT); }

    /** A blank Bangla name on edit means "not touched" — keep the stored one. */
    private static String keepBn(String in, String current) {
        return in == null || in.isBlank() ? current : in.trim();
    }

    private static void checkShopAmounts(Shop s) {
        if (s.getMonthlyTarget() != null && s.getMonthlyTarget().signum() < 0)
            throw new ApiException("Monthly target cannot be negative");
        if (s.getPettyCashFloat() != null && s.getPettyCashFloat().signum() < 0)
            throw new ApiException("Petty cash float cannot be negative");
    }

    // ---- update ----
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PutMapping("/shops/{id}")
    public Shop updateShop(@PathVariable UUID id, @RequestBody Shop in) {
        Shop s = shops.findById(id).orElseThrow(() -> new ApiException("Shop not found"));
        checkShopAmounts(in);
        s.setCode(in.getCode());
        s.setName(in.getName());
        s.setNameBn(keepBn(in.getNameBn(), s.getNameBn()));
        s.setPrimaryLine(in.getPrimaryLine());
        s.setAddress(in.getAddress());
        s.setMobile(in.getMobile());
        s.setLocation(in.getLocation());
        s.setMonthlyTarget(in.getMonthlyTarget());
        s.setPettyCashFloat(in.getPettyCashFloat());
        return shops.save(s);
    }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PutMapping("/warehouses/{id}")
    public Warehouse updateWarehouse(@PathVariable UUID id, @RequestBody Warehouse in) {
        Warehouse w = warehouses.findById(id).orElseThrow(() -> new ApiException("Warehouse not found"));
        w.setCode(in.getCode());
        w.setName(upper(in.getName()));
        w.setNameBn(keepBn(in.getNameBn(), w.getNameBn()));
        w.setAddress(in.getAddress());
        return warehouses.save(w);
    }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PutMapping("/products/{id}")
    public Product updateProduct(@PathVariable UUID id, @RequestBody Product in) {
        Product p = products.findById(id).orElseThrow(() -> new ApiException("Product not found"));
        checkBand(in.getPriceLower(), in.getPriceUpper());
        BigDecimal oldLower = p.getPriceLower(), oldUpper = p.getPriceUpper();
        p.setSku(in.getSku()); p.setName(in.getName()); p.setNameBn(keepBn(in.getNameBn(), p.getNameBn())); p.setType(in.getType());
        p.setThicknessMm(in.getThicknessMm()); p.setThicknessLabel(in.getThicknessLabel()); p.setUnit(in.getUnit());
        p.setPriceLower(in.getPriceLower()); p.setPriceUpper(in.getPriceUpper());
        p.setSupplierId(in.getSupplierId()); p.setCategory(in.getCategory()); p.setColor(in.getColor());
        p.setProductGroupId(in.getProductGroupId());
        p.setSupplierTag(in.getSupplierTag());
        p.setSide(in.getSide());
        p.setEdgingSize(in.getEdgingSize());
        p.setFullName(in.getFullName());
        p.setComments(in.getComments());
        p.setActive(in.isActive());
        Product saved = products.save(p);
        if (!sameMoney(oldLower, saved.getPriceLower()) || !sameMoney(oldUpper, saved.getPriceUpper()))
            auditBand(saved.getId(), oldLower, oldUpper, saved.getPriceLower(), saved.getPriceUpper());
        return saved;
    }

    /** Who changed a product's selling price band, newest first. */
    @GetMapping("/products/{id}/price-history")
    public List<Map<String, Object>> priceHistory(@PathVariable UUID id) {
        return jdbc.queryForList(
            "select old_lower as \"oldLower\", old_upper as \"oldUpper\", new_lower as \"newLower\", "
          + "new_upper as \"newUpper\", changed_by as \"changedBy\", changed_at as \"changedAt\" "
          + "from product_price_audit where product_id = ? order by changed_at desc", id);
    }

    private static void checkBand(BigDecimal lower, BigDecimal upper) {
        if ((lower != null && lower.signum() < 0) || (upper != null && upper.signum() < 0))
            throw new ApiException("Price limits cannot be negative");
        if (lower != null && upper != null && lower.compareTo(upper) > 0)
            throw new ApiException("Lower price limit (" + lower + ") cannot be above the upper limit (" + upper + ")");
    }

    private static boolean sameMoney(BigDecimal a, BigDecimal b) {
        return a == null ? b == null : b != null && a.compareTo(b) == 0;
    }

    private void auditBand(UUID productId, BigDecimal oldLower, BigDecimal oldUpper, BigDecimal newLower, BigDecimal newUpper) {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        String who = a != null && a.getPrincipal() instanceof com.mim.erp.auth.AuthPrincipal p ? p.username() : null;
        jdbc.update("insert into product_price_audit (product_id, old_lower, old_upper, new_lower, new_upper, changed_by) "
            + "values (?,?,?,?,?,?)", productId, oldLower, oldUpper, newLower, newUpper, who);
    }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PutMapping("/suppliers/{id}")
    public Supplier updateSupplier(@PathVariable UUID id, @RequestBody Supplier in) {
        Supplier s = suppliers.findById(id).orElseThrow(() -> new ApiException("Supplier not found"));
        s.setCode(in.getCode()); s.setName(in.getName()); s.setNameBn(keepBn(in.getNameBn(), s.getNameBn()));
        s.setMobile(in.getMobile()); s.setAddress(in.getAddress()); s.setGroupId(in.getGroupId());
        return suppliers.save(s);
    }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PutMapping("/supplier-groups/{id}")
    public SupplierGroup updateSupplierGroup(@PathVariable UUID id, @RequestBody SupplierGroup in) {
        SupplierGroup g = supplierGroups.findById(id).orElseThrow(() -> new ApiException("Supplier group not found"));
        g.setCode(in.getCode()); g.setName(in.getName()); g.setNameBn(keepBn(in.getNameBn(), g.getNameBn()));
        return supplierGroups.save(g);
    }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @PutMapping("/customers/{id}")
    public Customer updateCustomer(@PathVariable UUID id, @RequestBody Customer in) {
        Customer c = customers.findById(id).orElseThrow(() -> new ApiException("Customer not found"));
        c.setCode(in.getCode()); c.setName(in.getName()); c.setNameBn(keepBn(in.getNameBn(), c.getNameBn())); c.setType(in.getType());
        c.setMobile(in.getMobile()); c.setAddress(in.getAddress());
        c.setCreditLimit(in.getCreditLimit()); c.setCreditDays(in.getCreditDays());
        c.setDeliveryAddress(in.getDeliveryAddress());
        c.setDeliveryLandmark(in.getDeliveryLandmark());
        c.setDeliveryContactName(in.getDeliveryContactName());
        c.setDeliveryContactPhone(in.getDeliveryContactPhone());
        c.setDeliveryNote(in.getDeliveryNote());
        c.setDeliveryMapLink(in.getDeliveryMapLink());
        return customers.save(c);
    }

    // ---- delete (guards against rows still referenced by transactions) ----
    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @DeleteMapping("/shops/{id}")
    public void deleteShop(@PathVariable UUID id) { guardedDelete(() -> shops.deleteById(id), "shop"); }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @DeleteMapping("/warehouses/{id}")
    public void deleteWarehouse(@PathVariable UUID id) { guardedDelete(() -> warehouses.deleteById(id), "warehouse"); }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @DeleteMapping("/products/{id}")
    public void deleteProduct(@PathVariable UUID id) { guardedDelete(() -> products.deleteById(id), "product"); }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @DeleteMapping("/suppliers/{id}")
    public void deleteSupplier(@PathVariable UUID id) { guardedDelete(() -> suppliers.deleteById(id), "supplier"); }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @DeleteMapping("/supplier-groups/{id}")
    public void deleteSupplierGroup(@PathVariable UUID id) { guardedDelete(() -> supplierGroups.deleteById(id), "supplier group"); }

    @CacheEvict(cacheNames = MasterCache.NAME, allEntries = true)
    @DeleteMapping("/customers/{id}")
    public void deleteCustomer(@PathVariable UUID id) { guardedDelete(() -> customers.deleteById(id), "customer"); }

    private void guardedDelete(Runnable delete, String what) {
        try {
            delete.run();
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException("Cannot delete this " + what + " — it is already used by other records. Deactivate it instead.");
        }
    }
}
