package com.mim.erp.accounting;

import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.pdf.PdfWriter;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.util.Map;

import static com.mim.erp.common.SlipParts.*;

/** Contra voucher slip: money moved between our own cash and bank ledgers. */
final class ContraPdf {

    private ContraPdf() {}

    static byte[] render(Map<String, Object> v, boolean bn) {
        try {
            Document doc = PdfKit.slip();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            PdfKit.printActualSize(writer);
            doc.open();
            PdfKit kit = new PdfKit(bn, doc, writer);

            doc.add(kit.title(kit.l("CONTRA VOUCHER"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));
            BigDecimal amount = (BigDecimal) v.get("amount");
            String from = v.get("from_account") + " · " + kit.name((String) v.get("from_name_bn"), (String) v.get("from_name"));
            String to = v.get("to_account") + " · " + kit.name((String) v.get("to_name_bn"), (String) v.get("to_name"));
            doc.add(keyValues(kit, new String[][]{
                {"Voucher no.", (String) v.get("voucher_no")},
                {"Date", PdfKit.date(day(v.get("voucher_date")))},
                {"Paid out of (Cr)", from},
                {"Paid into (Dr)", to},
                {"Amount", kit.l("Tk") + " " + money(amount)},
                {"In words", bn ? ChequeReceiptPdf.banglaWords(amount) : "Taka " + ChequeReceiptPdf.words(amount) + " only"},
                {"Reference", (String) v.get("reference")},
                {"Note", (String) v.get("note")},
                {"Entered by", (String) (v.get("requested_by") != null ? v.get("requested_by") : v.get("created_by"))},
                {"Approved by", (String) v.get("approved_by")},
            }));
            doc.add(signatures(kit, "Prepared by", "Authorised by"));
            doc.close();
            return out.toByteArray();
        } catch (DocumentException e) {
            throw new ApiException("Failed to generate contra voucher");
        }
    }
}
