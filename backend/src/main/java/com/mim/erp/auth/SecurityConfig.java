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
                // user administration
                .requestMatchers("/api/users/**").hasRole("ADMIN")
                // employees / payroll master
                .requestMatchers("/api/hr/**").hasAnyRole("ADMIN", "ACCOUNTANT")
                // chart of accounts + financial year
                .requestMatchers("/api/accounting/coa/**", "/api/accounting/financial-year/**",
                                 "/api/accounting/journal/**")
                    .hasAnyRole("ADMIN", "ACCOUNTANT")
                // reads available to any authenticated user (master data, stock, account list)
                .requestMatchers(HttpMethod.GET, "/api/master/**", "/api/inventory/availability",
                        "/api/inventory/available", "/api/inventory/overview",
                        "/api/accounting/accounts").authenticated()
                // master data writes
                .requestMatchers(HttpMethod.POST, "/api/master/**").hasRole("ADMIN")
                // purchasing
                .requestMatchers("/api/purchase/**").hasAnyRole("MANAGER", "ADMIN")
                // stock adjustments + variance report
                .requestMatchers("/api/inventory/adjustments/**").hasAnyRole("MANAGER", "ADMIN")
                .requestMatchers("/api/inventory/price-variance").hasAnyRole("MANAGER", "ACCOUNTANT", "ADMIN")
                // sales floor
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
