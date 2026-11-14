package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Bill-wise party sub-ledger reads: open bills / advances, and the party's ledger for its statement. */
@RestController
@RequestMapping("/api/accounting")
public class PartyController {

    private final BillService bills;
    private final AccountRepository accounts;

    public PartyController(BillService bills, AccountRepository accounts) {
        this.bills = bills; this.accounts = accounts;
    }

    private static String type(String t) {
        String u = t == null ? "" : t.toUpperCase();
        if (!u.equals("CUSTOMER") && !u.equals("SUPPLIER")) throw new ApiException("Party type must be CUSTOMER or SUPPLIER");
        return u;
    }

    /** Open bills (oldest due first) and unallocated advances; balance = bills - advances. */
    @GetMapping("/parties/{type}/{id}/open-items")
    public Map<String, Object> openItems(@PathVariable String type, @PathVariable UUID id) {
        return bills.openItems(type(type), id);
    }

    /** The party's own ledger (null when nothing was ever posted to it), for the statement. */
    @GetMapping("/parties/{type}/{id}/ledger")
    public Map<String, Object> ledger(@PathVariable String type, @PathVariable UUID id) {
        Map<String, Object> out = new HashMap<>();
        accounts.findByPartyTypeAndPartyId(type(type), id).ifPresent(a -> {
            out.put("accountId", a.getId()); out.put("code", a.getCode());
        });
        return out;
    }

    public record MatchRequest(UUID creditId, List<BillService.Alloc> allocations) {}

    /** Match an advance against open bills by hand. */
    @PostMapping("/bills/match")
    public Map<String, Object> match(@RequestBody MatchRequest r) { return bills.match(r.creditId(), r.allocations()); }

    /** Undo every match of a bill or credit so it can be matched again. */
    @PostMapping("/bills/{itemId}/unmatch")
    public Map<String, Object> unmatch(@PathVariable UUID itemId) { return bills.unmatch(itemId); }

    /** Admin: rebuild every bill and allocation from the books, settled oldest-first; hand-picked matches are kept. */
    @PostMapping("/bills/rebuild")
    public Map<String, Object> rebuild() {
        return Map.of("items", bills.rebuild());
    }
}
