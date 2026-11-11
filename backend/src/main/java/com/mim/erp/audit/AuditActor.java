package com.mim.erp.audit;

import com.mim.erp.auth.AuthPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Who is acting right now, taken from the security context and the current HTTP request.
 * Outside a request (scheduled job, startup) every field is empty and the database records "system".
 */
public record AuditActor(String userId, String username, String name, String role,
                         String module, String ip, String userAgent) {

    public static final String SYSTEM = "system";

    public static AuditActor current() {
        String userId = "", username = "", name = "", role = "";
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthPrincipal p) {
            userId = p.userId().toString();
            username = cut(p.username(), 120);
            name = cut(p.fullName() == null || p.fullName().isBlank() ? p.username() : p.fullName(), 160);
            role = cut(p.role(), 30);
        }

        String module = "", ip = "", ua = "";
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            HttpServletRequest req = attrs.getRequest();
            module = moduleOf(req.getRequestURI());
            ip = clientIp(req);
            ua = cut(req.getHeader("User-Agent"), 400);
        }
        return new AuditActor(userId, username, name, role, module, ip, ua);
    }

    /** "/api/sales/orders/…" → "sales". A new controller package gets its module name for free. */
    static String moduleOf(String uri) {
        if (uri == null) return "";
        int at = uri.indexOf("/api/");
        if (at < 0) return "";
        String rest = uri.substring(at + 5);
        int slash = rest.indexOf('/');
        String seg = (slash < 0 ? rest : rest.substring(0, slash)).toLowerCase().replaceAll("[^a-z0-9_-]", "");
        return cut(seg, 40);
    }

    /** The web app proxies /api through Next.js, so the browser's address arrives in X-Forwarded-For. */
    static String clientIp(HttpServletRequest req) {
        String fwd = req.getHeader("X-Forwarded-For");
        String ip = fwd != null && !fwd.isBlank() ? fwd.split(",")[0].trim() : req.getRemoteAddr();
        if (ip != null && ip.startsWith("::ffff:")) ip = ip.substring(7);     // IPv4 seen through an IPv6 socket
        return cut(ip, 64);
    }

    static String cut(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }
}
