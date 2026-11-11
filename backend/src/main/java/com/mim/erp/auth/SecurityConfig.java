package com.mim.erp.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

@Configuration
public class SecurityConfig {

    @Value("${mim.cors.allowed-origins}")
    private String[] origins;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(c -> c.configurationSource(corsSource()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/api/auth/login").permitAll()
                // activity log — admin only, and read only (the controller has no write endpoint)
                .requestMatchers("/api/audit-log/**").hasRole("ADMIN")
                // user administration — reads open to any authenticated role (e.g. authoriser
                // pickers on sales screens), writes remain admin-only
                .requestMatchers(HttpMethod.GET, "/api/users/**").authenticated()
                .requestMatchers("/api/users/**").hasRole("ADMIN")
                // WhatsApp reminder switches + manual send
                .requestMatchers("/api/accounting/cheques/reminder-settings", "/api/accounting/cheques/*/remind")
                    .hasAnyRole("MANAGER", "ACCOUNTANT", "ADMIN")
                // employees / payroll master
                .requestMatchers("/api/hr/**").hasAnyRole("ADMIN", "ACCOUNTANT")
                // chart of accounts + financial year
                .requestMatchers(HttpMethod.GET, "/api/accounting/financial-year", "/api/accounting/financial-year/current")
                    .hasAnyRole("MANAGER", "ACCOUNTANT", "ADMIN")
                .requestMatchers("/api/accounting/financial-year/*/reopen").hasRole("ADMIN")
                .requestMatchers("/api/accounting/coa/**", "/api/accounting/financial-year/**",
                                 "/api/accounting/journal/**", "/api/accounting/fixed-assets/**", "/api/accounting/bank-recon/**")
                    .hasAnyRole("ADMIN", "ACCOUNTANT")
                // reads available to any authenticated user (master data, stock, account list)
                .requestMatchers(HttpMethod.GET, "/api/master/**", "/api/inventory/availability",
                        "/api/inventory/available", "/api/inventory/overview",
                        "/api/accounting/accounts").authenticated()
                // sales staff can add a customer from the sales screens
                .requestMatchers(HttpMethod.POST, "/api/master/customers").hasAnyRole("SALESPERSON", "MANAGER", "ADMIN")
                // master data writes — every method, not only POST: PUT and DELETE used to fall through
                // to "any authenticated user", so any role could edit or delete master records
                .requestMatchers("/api/master/**").hasRole("ADMIN")
                // purchasing
                .requestMatchers("/api/purchase/**").hasAnyRole("MANAGER", "ADMIN")
                // stock adjustments + variance report
                .requestMatchers("/api/inventory/adjustments/**").hasAnyRole("MANAGER", "ADMIN")
                .requestMatchers("/api/inventory/opening-import").hasRole("ADMIN")
                .requestMatchers("/api/inventory/price-variance").hasAnyRole("MANAGER", "ACCOUNTANT", "ADMIN")
                // sales floor
                .requestMatchers(HttpMethod.POST, "/api/sales/returns").hasAnyRole("MANAGER", "ADMIN")
                .requestMatchers("/api/sales/**").hasAnyRole("SALESPERSON", "MANAGER", "ADMIN")
                // cash movements
                .requestMatchers("/api/accounting/payments", "/api/accounting/petty-cash")
                    .hasAnyRole("ACCOUNTANT", "ADMIN")
                // financial statements
                .requestMatchers("/api/accounting/**").hasAnyRole("ACCOUNTANT", "MANAGER", "ADMIN")
                .anyRequest().authenticated())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }

    private CorsConfigurationSource corsSource() {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(Arrays.asList(origins));
        cfg.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
        cfg.setAllowedHeaders(List.of("Authorization","Content-Type"));
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/api/**", cfg);
        return src;
    }
}
