package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import com.mim.erp.common.AppSettings;
import com.mim.erp.common.WhatsAppClient;
import com.mim.erp.master.Customer;
import com.mim.erp.master.CustomerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * WhatsApp reminder the day before a cheque matures: "keep enough balance, we present your
 * cheque tomorrow at your {bank} account". Sent from an approved Meta template (EN or BN).
 */
@Service
public class ChequeReminderService {
    private static final Logger log = LoggerFactory.getLogger(ChequeReminderService.class);
    static final String K_ENABLED = "cheque_reminder_enabled";
    static final String K_LANG = "cheque_reminder_lang";

    private final ChequeRepository cheques;
    private final CustomerRepository customers;
    private final WhatsAppClient whatsapp;
    private final AppSettings settings;
    private final String templateEn;
    private final String templateBn;

    public ChequeReminderService(ChequeRepository cheques, CustomerRepository customers, WhatsAppClient whatsapp,
                                 AppSettings settings,
                                 @Value("${mim.whatsapp.template-en}") String templateEn,
                                 @Value("${mim.whatsapp.template-bn}") String templateBn) {
        this.cheques = cheques;
        this.customers = customers;
        this.whatsapp = whatsapp;
        this.settings = settings;
        this.templateEn = templateEn;
        this.templateBn = templateBn;
    }

    public record Settings(boolean enabled, String lang, boolean configured) {}

    public Settings getSettings() {
        return new Settings(Boolean.parseBoolean(settings.get(K_ENABLED, "true")),
            settings.get(K_LANG, "bn"), whatsapp.configured());
    }

    public Settings saveSettings(boolean enabled, String lang) {
        if (!"en".equals(lang) && !"bn".equals(lang)) throw new ApiException("Language must be en or bn");
        settings.put(K_ENABLED, String.valueOf(enabled));
        settings.put(K_LANG, lang);
        return getSettings();
    }

    /** Every morning, 09:00 Dhaka: remind customers whose open cheque matures tomorrow. */
    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Dhaka")
    public void runDaily() {
        if (!getSettings().enabled()) return;
        if (!whatsapp.configured()) {
            log.info("Cheque reminders skipped: WhatsApp token / phone id not configured");
            return;
        }
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        List<Cheque> due = cheques.findByMaturityDateAndStatusIn(tomorrow, Set.of("PENDING", "CASHED"));
        int sent = 0;
        for (Cheque c : due) {
            if (tomorrow.equals(c.getReminderForDate()) && "SENT".equals(c.getReminderStatus())) continue;
            try {
                if ("SENT".equals(send(c))) sent++;
            } catch (RuntimeException e) {
                log.warn("Cheque reminder failed for {}: {}", c.getChequeNo(), e.getMessage());
            }
        }
        log.info("Cheque reminders for {}: {} due, {} sent", tomorrow, due.size(), sent);
    }

    /** Manual send/resend from the cheques page. Returns the saved cheque. */
    public Cheque remind(UUID id) {
        Cheque c = cheques.findById(id).orElseThrow(() -> new ApiException("Cheque not found"));
        if (Set.of("POSTED", "CANCELLED").contains(c.getStatus()))
            throw new ApiException("This cheque is already " + c.getStatus().toLowerCase());
        if (!whatsapp.configured()) throw new ApiException("WhatsApp is not configured on the server");
        send(c);
        if ("FAILED".equals(c.getReminderStatus()) || "SKIPPED".equals(c.getReminderStatus()))
            throw new ApiException(c.getReminderError());
        return c;
    }

    /** Sends one reminder and records the outcome on the cheque. Returns the status. */
    private String send(Cheque c) {
        c.setReminderForDate(c.getMaturityDate());
        c.setReminderSentAt(OffsetDateTime.now());
        c.setReminderError(null);
        Customer cu = customers.findById(c.getCustomerId()).orElse(null);
        String to = cu == null ? null : WhatsAppClient.normalizeMobile(cu.getMobile());
        if (to == null) {
            c.setReminderStatus("SKIPPED");
            c.setReminderError("Customer has no valid mobile number");
            cheques.save(c);
            return "SKIPPED";
        }
        boolean bn = "bn".equals(getSettings().lang());
        String name = bn && cu.getNameBn() != null && !cu.getNameBn().isBlank() ? cu.getNameBn() : cu.getName();
        String bank = c.getBankName() == null || c.getBankName().isBlank() ? (bn ? "ব্যাংক" : "bank") : c.getBankName();
        String amount = NumberFormat.getNumberInstance(new Locale("en", "IN")).format(c.getAmount());
        try {
            whatsapp.sendTemplate(to, bn ? templateBn : templateEn, bn ? "bn" : "en",
                List.of(name, c.getChequeNo(), amount, bank));
            c.setReminderStatus("SENT");
        } catch (RuntimeException e) {
            String m = e.getMessage() == null ? "send failed" : e.getMessage();
            c.setReminderStatus("FAILED");
            c.setReminderError(m.length() > 250 ? m.substring(0, 250) : m);
        }
        cheques.save(c);
        return c.getReminderStatus();
    }
}
