package com.mim.erp.accounting;

import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.mim.erp.accounting.ReportService.bd;
import static com.mim.erp.accounting.ReportService.net;

/**
 * IFRS-style financial statements (IAS 1 presentation, IAS 7 indirect cash flow) with a
 * comparative column for the previous financial year and a numbered notes breakdown.
 *
 * Every statement is returned as a flat list of rows - heading / line / subtotal / total / gap -
 * so the screen, print and export all render the same thing.
 */
@Service
public class StatementService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;
    private static final Set<String> CASH_CODES = Set.of("1000", "1300");

    private final ReportService reports;

    public StatementService(ReportService reports) { this.reports = reports; }

    // ------------------------------------------------------------------ line definitions
    private record Def(String key, String label, String bn) {}

    private static final Def PPE  = new Def("PPE",  "Property, plant and equipment", "সম্পত্তি, স্থাপনা ও যন্ত্রপাতি");
    private static final Def INV  = new Def("INV",  "Inventories", "মজুদ পণ্য");
    private static final Def REC  = new Def("REC",  "Trade and other receivables", "বাণিজ্যিক ও অন্যান্য প্রাপ্য");
    private static final Def TAXA = new Def("TAXA", "Advance tax and VAT recoverable", "অগ্রিম কর ও ফেরতযোগ্য ভ্যাট");
    private static final Def CASH = new Def("CASH", "Cash and cash equivalents", "নগদ ও নগদ সমতুল্য");
    private static final Def OCA  = new Def("OCA",  "Other current assets", "অন্যান্য চলতি সম্পদ");
    private static final Def CAP  = new Def("CAP",  "Owner's capital", "মালিকের মূলধন");
    private static final Def RE   = new Def("RE",   "Retained earnings", "সঞ্চিত মুনাফা");
    private static final Def OEQ  = new Def("OEQ",  "Other reserves", "অন্যান্য সংরক্ষিত তহবিল");
    private static final Def PFY  = new Def("PFY",  "Profit for the year", "বছরের মুনাফা");
    private static final Def LTB  = new Def("LTB",  "Long-term borrowings", "দীর্ঘমেয়াদি ঋণ");
    private static final Def TP   = new Def("TP",   "Trade payables", "বাণিজ্যিক পাওনা");
    private static final Def TAXP = new Def("TAXP", "Tax and VAT payable", "প্রদেয় কর ও ভ্যাট");
    private static final Def OP   = new Def("OP",   "Other payables", "অন্যান্য প্রদেয়");
    private static final Def REV  = new Def("REV",  "Revenue", "বিক্রয় আয়");
    private static final Def COS  = new Def("COS",  "Cost of sales", "বিক্রীত পণ্যের ব্যয়");
    private static final Def OI   = new Def("OI",   "Other income", "অন্যান্য আয়");
    private static final Def OPX  = new Def("OPX",  "Selling, administrative and other expenses", "বিক্রয়, প্রশাসনিক ও অন্যান্য ব্যয়");
    private static final Def DEP  = new Def("DEP",  "Depreciation", "অবচয়");
    private static final Def OEXP = new Def("OEXP", "Loss on disposal of assets", "সম্পদ বিক্রয়ে ক্ষতি");

    private static Def assetDef(String code, String grp) {
        if ("A-FA".equals(grp)) return PPE;
        if ("1200".equals(code)) return INV;
        if ("A-BK".equals(grp) || CASH_CODES.contains(code)) return CASH;
        if ("1450".equals(code) || "1460".equals(code)) return TAXA;
        if ("SD".equals(grp) || "1100".equals(code) || "1400".equals(code)) return REC;
        return OCA;
    }
    private static Def liabDef(String code, String grp) {
        if ("L-NC".equals(grp)) return LTB;
        if ("SC".equals(grp) || "2000".equals(code)) return TP;
        if ("2100".equals(code) || "2120".equals(code)) return TAXP;
        return OP;
    }
    private static Def equityDef(String code) {
        if ("3000".equals(code)) return CAP;
        if ("3100".equals(code)) return RE;
        return OEQ;
    }
    private static Def plDef(String type, String code, String grp) {
        if ("INCOME".equals(type)) return "4100".equals(code) ? OI : REV;
        if ("X-DC".equals(grp)) return COS;
        if ("5400".equals(code)) return DEP;
        if ("5900".equals(code)) return OEXP;
        return OPX;
    }

    // ------------------------------------------------------------------ per-period figures
    /** Amounts per line key plus the ledgers behind each (for the notes). */
    private static final class Fig {
        final Map<String, BigDecimal> amt = new LinkedHashMap<>();
        final Map<String, List<Object[]>> accts = new LinkedHashMap<>();
        void add(Def d, Map<String, Object> r, BigDecimal v) {
            if (v.signum() == 0) return;
            amt.merge(d.key(), v, BigDecimal::add);
            accts.computeIfAbsent(d.key(), k -> new ArrayList<>()).add(new Object[]{r.get("code"), r.get("name"), r.get("name_bn"), v});
        }
        BigDecimal get(Def d) { return amt.getOrDefault(d.key(), ZERO); }
        BigDecimal sum(Def... ds) { BigDecimal s = ZERO; for (Def d : ds) s = s.add(get(d)); return s; }
    }

    private Fig position(ReportService.Period p) {
        Fig f = new Fig();
        BigDecimal plNet = ZERO;
        for (Map<String, Object> r : reports.accountRows(p, false, "ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE")) {
            BigDecimal n = net(r);
            String type = (String) r.get("type"), code = (String) r.get("code"), grp = (String) r.get("group_code");
            switch (type) {
                case "ASSET" -> f.add(assetDef(code, grp), r, n);
                case "LIABILITY" -> f.add(liabDef(code, grp), r, n.negate());
                case "EQUITY" -> f.add(equityDef(code), r, n.negate());
                default -> plNet = plNet.add(n);
            }
        }
        // profit not yet closed into retained earnings (zero once the year is closed)
        f.amt.merge(PFY.key(), plNet.negate(), BigDecimal::add);
        if (plNet.signum() != 0) f.accts.computeIfAbsent(PFY.key(), k -> new ArrayList<>())
            .add(new Object[]{"", "Net profit / (loss) for the year", "বছরের নিট মুনাফা / (ক্ষতি)", plNet.negate()});
        return f;
    }

    private Fig profit(ReportService.Period p) {
        Fig f = new Fig();
        for (Map<String, Object> r : reports.accountRows(p, true, "INCOME", "EXPENSE")) {
            String type = (String) r.get("type");
            BigDecimal v = "INCOME".equals(type) ? bd(r.get("period_credit")).subtract(bd(r.get("period_debit")))
                                                  : bd(r.get("period_debit")).subtract(bd(r.get("period_credit")));
            f.add(plDef(type, (String) r.get("code"), (String) r.get("group_code")), r, v);
        }
        return f;
    }

    // ------------------------------------------------------------------ row builder
    private final class Builder {
        final List<Map<String, Object>> rows = new ArrayList<>();
        final List<Map<String, Object>> notes = new ArrayList<>();
        final Fig cur, pri;
        final boolean cmp;
        int noteNo = 0;
        Builder(Fig cur, Fig pri) { this(cur, pri, pri != null); }
        Builder(Fig cur, Fig pri, boolean cmp) { this.cur = cur; this.pri = pri; this.cmp = cmp; }

        void heading(String label, String bn) { row("heading", label, bn, null, null, null); }
        void gap() { row("gap", "", "", null, null, null); }
        void line(Def d) { line(d, false); }
        /** @param negate show the amount with its sign flipped (expenses as deductions) */
        void line(Def d, boolean negate) {
            BigDecimal c = cur.get(d), p = pri == null ? ZERO : pri.get(d);
            if (c.signum() == 0 && p.signum() == 0) return;
            Integer note = null;
            if (cur.accts.containsKey(d.key()) || (pri != null && pri.accts.containsKey(d.key()))) {
                note = ++noteNo;
                notes.add(noteFor(note, d));
            }
            row("line", d.label(), d.bn(), negate ? c.negate() : c, cmp ? (negate ? p.negate() : p) : null, note);
        }
        void subtotal(String label, String bn, BigDecimal c, BigDecimal p) { row("subtotal", label, bn, c, cmp ? p : null, null); }
        void total(String label, String bn, BigDecimal c, BigDecimal p) { row("total", label, bn, c, cmp ? p : null, null); }
        void plain(String label, String bn, BigDecimal c, BigDecimal p) { row("line", label, bn, c, cmp ? p : null, null); }

        private void row(String kind, String label, String bn, BigDecimal c, BigDecimal p, Integer note) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", kind); m.put("label", label); m.put("labelBn", bn);
            m.put("amount", c); m.put("prior", p); m.put("note", note);
            rows.add(m);
        }

        private Map<String, Object> noteFor(int no, Def d) {
            Map<String, Map<String, Object>> byCode = new LinkedHashMap<>();
            for (Object[] a : cur.accts.getOrDefault(d.key(), List.of()))
                byCode.computeIfAbsent((String) a[0] + "|" + a[1], k -> acct(a)).put("amount", a[3]);
            if (pri != null) for (Object[] a : pri.accts.getOrDefault(d.key(), List.of()))
                byCode.computeIfAbsent((String) a[0] + "|" + a[1], k -> acct(a)).put("prior", a[3]);
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("no", no); n.put("title", d.label()); n.put("titleBn", d.bn());
            n.put("accounts", new ArrayList<>(byCode.values()));
            return n;
        }
        private Map<String, Object> acct(Object[] a) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", a[0]); m.put("name", a[1]); m.put("nameBn", a[2]); m.put("amount", ZERO); m.put("prior", ZERO);
            return m;
        }
    }

    private Map<String, Object> envelope(String title, ReportService.Period p, ReportService.Period prior, Builder b) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", title);
        m.put("yearName", p.name()); m.put("yearStatus", p.status());
        m.put("from", p.start().toString()); m.put("to", p.end().toString());
        m.put("priorYearName", prior == null ? null : prior.name());
        m.put("priorTo", prior == null ? null : prior.end().toString());
        m.put("rows", b.rows); m.put("notes", b.notes);
        return m;
    }

    private ReportService.Period priorPeriod(UUID yearId) {
        UUID prev = reports.previousYearId(yearId);
        return prev == null ? null : reports.period(prev);
    }

    // ------------------------------------------------------------------ statement of financial position
    public Map<String, Object> financialPosition(UUID yearId) {
        ReportService.Period p = reports.period(yearId), pp = priorPeriod(yearId);
        Fig c = position(p), o = pp == null ? null : position(pp);
        Fig z = new Fig();
        Builder b = new Builder(c, o);
        Fig oo = o == null ? z : o;

        b.heading("ASSETS", "সম্পদ");
        b.heading("Non-current assets", "স্থায়ী সম্পদ");
        b.line(PPE);
        BigDecimal nca = c.get(PPE), ncaP = oo.get(PPE);
        b.subtotal("Total non-current assets", "মোট স্থায়ী সম্পদ", nca, ncaP);
        b.heading("Current assets", "চলতি সম্পদ");
        for (Def d : new Def[]{INV, REC, TAXA, CASH, OCA}) b.line(d);
        BigDecimal ca = c.sum(INV, REC, TAXA, CASH, OCA), caP = oo.sum(INV, REC, TAXA, CASH, OCA);
        b.subtotal("Total current assets", "মোট চলতি সম্পদ", ca, caP);
        b.total("TOTAL ASSETS", "মোট সম্পদ", nca.add(ca), ncaP.add(caP));
        b.gap();

        b.heading("EQUITY AND LIABILITIES", "মালিকানা স্বত্ব ও দায়");
        b.heading("Equity", "মালিকানা স্বত্ব");
        for (Def d : new Def[]{CAP, RE, OEQ, PFY}) b.line(d);
        BigDecimal eq = c.sum(CAP, RE, OEQ, PFY), eqP = oo.sum(CAP, RE, OEQ, PFY);
        b.subtotal("Total equity", "মোট মালিকানা স্বত্ব", eq, eqP);
        b.heading("Non-current liabilities", "দীর্ঘমেয়াদি দায়");
        b.line(LTB);
        BigDecimal ncl = c.get(LTB), nclP = oo.get(LTB);
        b.subtotal("Total non-current liabilities", "মোট দীর্ঘমেয়াদি দায়", ncl, nclP);
        b.heading("Current liabilities", "চলতি দায়");
        for (Def d : new Def[]{TP, TAXP, OP}) b.line(d);
        BigDecimal cl = c.sum(TP, TAXP, OP), clP = oo.sum(TP, TAXP, OP);
        b.subtotal("Total current liabilities", "মোট চলতি দায়", cl, clP);
        BigDecimal tle = eq.add(ncl).add(cl), tleP = eqP.add(nclP).add(clP);
        b.total("TOTAL EQUITY AND LIABILITIES", "মোট মালিকানা স্বত্ব ও দায়", tle, tleP);

        Map<String, Object> out = envelope("Statement of financial position", p, pp, b);
        out.put("balanced", nca.add(ca).compareTo(tle) == 0);
        out.put("difference", nca.add(ca).subtract(tle));
        return out;
    }

    // ------------------------------------------------------------------ statement of profit or loss
    public Map<String, Object> profitOrLoss(UUID yearId) {
        ReportService.Period p = reports.period(yearId), pp = priorPeriod(yearId);
        Fig c = profit(p), o = pp == null ? null : profit(pp);
        Fig oo = o == null ? new Fig() : o;
        Builder b = new Builder(c, o);

        b.line(REV);
        b.line(COS, true);
        BigDecimal gp = c.get(REV).subtract(c.get(COS)), gpP = oo.get(REV).subtract(oo.get(COS));
        b.subtotal("Gross profit", "মোট মুনাফা", gp, gpP);
        b.line(OI);
        b.line(OPX, true);
        b.line(DEP, true);
        b.line(OEXP, true);
        BigDecimal np = gp.add(c.get(OI)).subtract(c.sum(OPX, DEP, OEXP));
        BigDecimal npP = gpP.add(oo.get(OI)).subtract(oo.sum(OPX, DEP, OEXP));
        b.total(np.signum() >= 0 ? "Profit for the year" : "Loss for the year",
                np.signum() >= 0 ? "বছরের মুনাফা" : "বছরের ক্ষতি", np, npP);

        Map<String, Object> out = envelope("Statement of profit or loss", p, pp, b);
        out.put("netProfit", np);
        return out;
    }

    // ------------------------------------------------------------------ statement of changes in equity
    public Map<String, Object> changesInEquity(UUID yearId) {
        ReportService.Period p = reports.period(yearId);
        BigDecimal capOpen = ZERO, reOpen = ZERO, capMove = ZERO, reMove = ZERO;
        for (Map<String, Object> r : reports.accountRows(p, true, "EQUITY")) {
            BigDecimal open = bd(r.get("opening_credit")).subtract(bd(r.get("opening_debit")));
            BigDecimal move = bd(r.get("period_credit")).subtract(bd(r.get("period_debit")));
            if ("3100".equals(r.get("code"))) { reOpen = reOpen.add(open); reMove = reMove.add(move); }
            else { capOpen = capOpen.add(open); capMove = capMove.add(move); }
        }
        BigDecimal profit = (BigDecimal) profitOrLoss(yearId).get("netProfit");
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(eqRow("Balance at start of year", "বছরের শুরুতে জের", capOpen, reOpen, "line"));
        rows.add(eqRow("Profit / (loss) for the year", "বছরের মুনাফা / (ক্ষতি)", ZERO, profit, "line"));
        rows.add(eqRow("Capital introduced / (withdrawn) and other movements", "মূলধন প্রদান / (উত্তোলন) ও অন্যান্য পরিবর্তন", capMove, reMove, "line"));
        rows.add(eqRow("Balance at end of year", "বছরের শেষে জের", capOpen.add(capMove), reOpen.add(profit).add(reMove), "total"));

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", "Statement of changes in equity");
        m.put("yearName", p.name()); m.put("yearStatus", p.status());
        m.put("from", p.start().toString()); m.put("to", p.end().toString());
        m.put("columns", List.of("Owner's capital", "Retained earnings", "Total equity"));
        m.put("columnsBn", List.of("মালিকের মূলধন", "সঞ্চিত মুনাফা", "মোট মালিকানা স্বত্ব"));
        m.put("rows", rows);
        return m;
    }

    private static Map<String, Object> eqRow(String label, String bn, BigDecimal cap, BigDecimal re, String kind) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind); m.put("label", label); m.put("labelBn", bn);
        m.put("values", List.of(cap, re, cap.add(re)));
        return m;
    }

    // ------------------------------------------------------------------ statement of cash flows (IAS 7, indirect)
    private static final class Flow {
        BigDecimal profit = ZERO, dep = ZERO, gain = ZERO, loss = ZERO;
        BigDecimal dInv = ZERO, dRec = ZERO, dOca = ZERO, dTaxa = ZERO, dTp = ZERO, dTaxp = ZERO, dOp = ZERO;
        BigDecimal dNbv = ZERO, capital = ZERO, borrowings = ZERO;
        BigDecimal cashOpen = ZERO, cashMove = ZERO;
        BigDecimal wc() { return dInv.negate().subtract(dRec).subtract(dOca).subtract(dTaxa).add(dTp).add(dTaxp).add(dOp); }
        BigDecimal operating() { return profit.add(dep).subtract(gain).add(loss).add(wc()); }
        BigDecimal investing() { return dNbv.negate().subtract(dep).add(gain).subtract(loss); }
        BigDecimal financing() { return capital.add(borrowings); }
        BigDecimal netChange() { return operating().add(investing()).add(financing()); }
    }

    private Flow flow(ReportService.Period p) {
        Flow f = new Flow();
        for (Map<String, Object> r : reports.accountRows(p, true, "ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE")) {
            String type = (String) r.get("type"), code = (String) r.get("code"), grp = (String) r.get("group_code");
            BigDecimal dr = bd(r.get("period_debit")).subtract(bd(r.get("period_credit")));   // movement, debit-positive
            switch (type) {
                case "INCOME" -> { BigDecimal v = dr.negate(); f.profit = f.profit.add(v); if ("4100".equals(code)) f.gain = f.gain.add(v); }
                case "EXPENSE" -> { f.profit = f.profit.subtract(dr); if ("5400".equals(code)) f.dep = f.dep.add(dr); if ("5900".equals(code)) f.loss = f.loss.add(dr); }
                case "ASSET" -> {
                    if ("A-BK".equals(grp) || CASH_CODES.contains(code)) {
                        f.cashMove = f.cashMove.add(dr);
                        f.cashOpen = f.cashOpen.add(bd(r.get("opening_debit")).subtract(bd(r.get("opening_credit"))));
                    } else if ("A-FA".equals(grp)) f.dNbv = f.dNbv.add(dr);
                    else if ("1200".equals(code)) f.dInv = f.dInv.add(dr);
                    else if ("1450".equals(code) || "1460".equals(code)) f.dTaxa = f.dTaxa.add(dr);
                    else if ("SD".equals(grp) || "1100".equals(code) || "1400".equals(code)) f.dRec = f.dRec.add(dr);
                    else f.dOca = f.dOca.add(dr);
                }
                case "LIABILITY" -> {
                    BigDecimal cr = dr.negate();
                    if ("L-NC".equals(grp)) f.borrowings = f.borrowings.add(cr);
                    else if ("SC".equals(grp) || "2000".equals(code)) f.dTp = f.dTp.add(cr);
                    else if ("2100".equals(code) || "2120".equals(code)) f.dTaxp = f.dTaxp.add(cr);
                    else f.dOp = f.dOp.add(cr);
                }
                default -> f.capital = f.capital.add(dr.negate());   // EQUITY (closing entries already excluded)
            }
        }
        return f;
    }

    public Map<String, Object> cashFlows(UUID yearId) {
        ReportService.Period p = reports.period(yearId), pp = priorPeriod(yearId);
        Flow c = flow(p), o = pp == null ? null : flow(pp);
        Flow z = new Flow();
        Flow q = o == null ? z : o;
        boolean cmp = o != null;
        Builder b = new Builder(new Fig(), null, cmp);
        b.heading("Cash flows from operating activities", "পরিচালন কার্যক্রম থেকে নগদ প্রবাহ");
        row(b, "Profit for the year", "বছরের মুনাফা", c.profit, q.profit, cmp);
        b.heading("Adjustments for:", "সমন্বয়:");
        row(b, "Depreciation", "অবচয়", c.dep, q.dep, cmp);
        row(b, "(Gain) / loss on disposal of assets", "সম্পদ বিক্রয়ে (লাভ) / ক্ষতি", c.loss.subtract(c.gain), q.loss.subtract(q.gain), cmp);
        b.heading("Changes in working capital:", "কার্যকরী মূলধনের পরিবর্তন:");
        row(b, "(Increase) / decrease in inventories", "মজুদ পণ্যে (বৃদ্ধি) / হ্রাস", c.dInv.negate(), q.dInv.negate(), cmp);
        row(b, "(Increase) / decrease in receivables", "প্রাপ্যে (বৃদ্ধি) / হ্রাস", c.dRec.negate(), q.dRec.negate(), cmp);
        row(b, "(Increase) / decrease in other current assets", "অন্যান্য চলতি সম্পদে (বৃদ্ধি) / হ্রাস", c.dOca.add(c.dTaxa).negate(), q.dOca.add(q.dTaxa).negate(), cmp);
        row(b, "Increase / (decrease) in trade payables", "বাণিজ্যিক পাওনায় বৃদ্ধি / (হ্রাস)", c.dTp, q.dTp, cmp);
        row(b, "Increase / (decrease) in tax and other payables", "কর ও অন্যান্য প্রদেয়তে বৃদ্ধি / (হ্রাস)", c.dTaxp.add(c.dOp), q.dTaxp.add(q.dOp), cmp);
        b.subtotal("Net cash from operating activities", "পরিচালন কার্যক্রম থেকে নিট নগদ", c.operating(), q.operating());

        b.gap();
        b.heading("Cash flows from investing activities", "বিনিয়োগ কার্যক্রম থেকে নগদ প্রবাহ");
        row(b, "Purchase of property, plant and equipment, net of disposal proceeds", "সম্পত্তি, স্থাপনা ও যন্ত্রপাতি ক্রয় (বিক্রয়লব্ধ অর্থ বাদে)", c.investing(), q.investing(), cmp);
        b.subtotal("Net cash used in investing activities", "বিনিয়োগ কার্যক্রমে ব্যবহৃত নিট নগদ", c.investing(), q.investing());
        b.gap();
        b.heading("Cash flows from financing activities", "অর্থায়ন কার্যক্রম থেকে নগদ প্রবাহ");
        row(b, "Capital introduced / (withdrawn)", "মূলধন প্রদান / (উত্তোলন)", c.capital, q.capital, cmp);
        row(b, "Proceeds from / (repayment of) borrowings", "ঋণ গ্রহণ / (পরিশোধ)", c.borrowings, q.borrowings, cmp);
        b.subtotal("Net cash from financing activities", "অর্থায়ন কার্যক্রম থেকে নিট নগদ", c.financing(), q.financing());
        b.gap();
        b.subtotal("Net increase / (decrease) in cash", "নগদের নিট বৃদ্ধি / (হ্রাস)", c.netChange(), q.netChange());
        row(b, "Cash and cash equivalents at start of year", "বছরের শুরুতে নগদ ও নগদ সমতুল্য", c.cashOpen, q.cashOpen, cmp);
        b.total("Cash and cash equivalents at end of year", "বছরের শেষে নগদ ও নগদ সমতুল্য", c.cashOpen.add(c.netChange()), q.cashOpen.add(q.netChange()));

        Map<String, Object> out = envelope("Statement of cash flows", p, pp, b);
        BigDecimal diff = c.netChange().subtract(c.cashMove);
        out.put("reconciles", diff.signum() == 0);
        out.put("difference", diff);
        out.put("bookCashClosing", c.cashOpen.add(c.cashMove));
        return out;
    }

    private static void row(Builder b, String label, String bn, BigDecimal c, BigDecimal p, boolean cmp) {
        if (c.signum() == 0 && (!cmp || p.signum() == 0)) return;
        b.plain(label, bn, c, p);
    }
}
