package com.mim.erp.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/** Reads "Authorization: Bearer <jwt>", verifies it, and sets the security context. */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwt;

    public JwtAuthFilter(JwtService jwt) { this.jwt = jwt; }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest req,
                                    @NonNull HttpServletResponse res,
                                    @NonNull FilterChain chain)
            throws ServletException, IOException {
        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            AuthPrincipal p = jwt.parse(header.substring(7));
            if (p != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                var authority = new SimpleGrantedAuthority("ROLE_" + p.role());
                var auth = new UsernamePasswordAuthenticationToken(p, null, List.of(authority));
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }
        chain.doFilter(req, res);
    }
}
