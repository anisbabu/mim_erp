package com.mim.erp.purchase;

import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.pdf.PdfWriter;
import com.mim.erp.accounting.ChequeReceiptPdf;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.mim.erp.common.SlipParts.*;

/** Debit note (goods returned, supplier owes us) / purchase return refund slip, slip size. */
final class DebitNotePdf {

    private DebitNotePdf() {}

    static byte[] render(Map<String, Object> r, List<Map<String, Object>> lines, boolean bn) {
        try {
            Document doc = PdfKit.slip();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            PdfKit.printActualSize(writer);
            doc.open();
            PdfKit kit = new PdfKit(bn, doc, writer);
            boolean note = "DEBIT_NOTE".equals(r.get("settlement"));

            doc.add(kit.title(kit.l(note ? "DEBIT NOTE" : "PURCHASE RETURN"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));

            BigDecimal value = (BigDecimal) r.get("goods_value");
            BigDecimal vat = r.get("vat") == null ? BigDecimal.ZERO : (BigDecimal) r.get("vat");
            String supplier = kit.name((String) r.get("supplier_name_bn"), (String) r.get("supplier_name"))
                + " (" + r.get("supplier_code") + ")";
            doc.add(keyValues(kit, new String[][]{
                {note ? "Debit note no." : "Return no.", (String) (note ? r.get("debit_note_no") : r.get("return_no"))},
                {"Return no.", note ? (String) r.get("return_no") : null},
                {"Date", PdfKit.date(day(r.get("return_date")))},
                {"Supplier", supplier},
                {"Against bill", (String) r.get("bill_ref")},
                {"Reason", (String) r.get("reason")},
                {"Settlement", note ? kit.l("Adjusted against the supplier's account")
                    : kit.l("Refund received in") + " " + r.get("refund_ledger")},
            }));

            List<String[]> rows = new ArrayList<>();
            for (Map<String, Object> l : lines) {
                BigDecimal qty = (BigDecimal) l.get("qty"), price = (BigDecimal) l.get("unit_price");
                rows.add(new String[]{kit.name((String) l.get("name_bn"), (String) l.get("name")),
                    qty.stripTrailingZeros().toPlainString(), money(price), money(qty.multiply(price))});
            }
            doc.add(kit.para(kit.l("Goods returned"), true, false, 9, Color.BLACK, Element.ALIGN_LEFT, 8, 3));
            doc.add(items(kit, new float[]{2.6f, 0.8f, 1.1f, 1.2f}, new String[]{"Product", "Qty", "Unit Price", "Amount"}, 1,
                rows, new String[]{"TOTAL", money(value)}));

            doc.add(keyValues(kit, new String[][]{
                {"Input VAT reversed", vat.signum() > 0 ? kit.l("Tk") + " " + money(vat) : null},
                {"In words", bn ? ChequeReceiptPdf.banglaWords(value) : "Taka " + ChequeReceiptPdf.words(value) + " only"},
            }));
            doc.add(signatures(kit, "Supplier's acknowledgement", "Authorised by"));
            doc.close();
            return out.toByteArray();
        } catch (DocumentException e) {
            throw new ApiException("Failed to generate debit note");
        }
    }
}
