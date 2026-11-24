package com.mim.erp.sales;

import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocLinkSigner;
import com.mim.erp.common.WhatsAppClient;
import com.mim.erp.master.Customer;
import com.mim.erp.master.CustomerRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * Backs the "Share" button on sales documents: instead of opening the OS share sheet, it sends the
 * PDF straight to the customer's WhatsApp through an approved Meta Business document template.
 * Requires mim.whatsapp.* to be configured (token, phone-id, template-doc-en/bn) and the template
 * approved in Meta Business Manager with a dynamic Document header.
 */
@Service
public class WhatsAppShareService {
    public enum DocKind { TOKEN, CHALLAN, INVOICE }

    private final SalesOrderRepository orders;
    private final DeliveryChallanRepository challans;
    private final CustomerRepository customers;
    private final WhatsAppClient whatsapp;
    private final DocLinkSigner signer;
    private final String publicBaseUrl;
    private final String templateEn;
    private final String templateBn;

    public WhatsAppShareService(SalesOrderRepository orders, DeliveryChallanRepository challans, CustomerRepository customers,
                                 WhatsAppClient whatsapp, DocLinkSigner signer,
                                 @Value("${mim.whatsapp.public-base-url}") String publicBaseUrl,
                                 @Value("${mim.whatsapp.template-doc-en}") String templateEn,
                                 @Value("${mim.whatsapp.template-doc-bn}") String templateBn) {
        this.orders = orders;
        this.challans = challans;
        this.customers = customers;
        this.whatsapp = whatsapp;
        this.signer = signer;
        this.publicBaseUrl = publicBaseUrl;
        this.templateEn = templateEn;
        this.templateBn = templateBn;
    }

    /** Share a sales-order document (dispatch token / challan / invoice). Returns the number it was sent to. */
    public String shareOrderDoc(UUID soId, DocKind kind, List<UUID> dcIds, String lang, String toOverride) {
        SalesOrder so = orders.findById(soId).orElseThrow(() -> new ApiException("Sales order not found"));
        Customer cu = customers.findById(so.getCustomerId()).orElseThrow(() -> new ApiException("Customer not found"));
        String to = resolveTo(toOverride, so.getDeliveryMobile(), cu.getMobile());
        String kindToken = switch (kind) {
            case TOKEN -> "SO_TOKEN";
            case CHALLAN -> "SO_CHALLAN";
            case INVOICE -> "SO_INVOICE";
        };
        String label = switch (kind) {
            case TOKEN -> "Dispatch Token";
            case CHALLAN -> "Delivery Challan";
            case INVOICE -> "Invoice";
        };
        send(cu, to, kindToken, soId, kind == DocKind.INVOICE ? List.of() : dcIds, lang, label, so.getSoNo());
        return to;
    }

    /** Share a standalone delivery-challan PDF (challans list page — no sales-order context needed). Returns the number it was sent to. */
    public String shareChallanDoc(UUID dcId, String lang, String toOverride) {
        DeliveryChallan dc = challans.findById(dcId).orElseThrow(() -> new ApiException("Challan not found"));
        Customer cu = customers.findById(dc.getCustomerId()).orElseThrow(() -> new ApiException("Customer not found"));
        String to = resolveTo(toOverride, null, cu.getMobile());
        send(cu, to, "DC_CHALLAN", dcId, List.of(), lang, "Delivery Challan", dc.getDcNo());
        return to;
    }

    private void send(Customer cu, String to, String kindToken, UUID id, List<UUID> dcIds, String lang, String label, String docNo) {
        boolean bn = "bn".equalsIgnoreCase(lang);
        String token = signer.sign(kindToken, id, dcIds, lang, Duration.ofMinutes(30));
        String url = publicBaseUrl + "/public/wa/" + token;
        String custName = bn && cu.getNameBn() != null && !cu.getNameBn().isBlank() ? cu.getNameBn() : cu.getName();
        String filename = label.replace(" ", "-") + "-" + docNo + ".pdf";
        whatsapp.sendDocumentTemplate(to, bn ? templateBn : templateEn, bn ? "bn" : "en", url, filename, List.of(custName, label, docNo));
    }

    private String resolveTo(String override, String deliveryMobile, String customerMobile) {
        String to = WhatsAppClient.normalizeMobile(override);
        if (to == null) to = WhatsAppClient.normalizeMobile(deliveryMobile);
        if (to == null) to = WhatsAppClient.normalizeMobile(customerMobile);
        if (to == null) throw new ApiException("No valid WhatsApp number on file for this customer");
        return to;
    }
}
