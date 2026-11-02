package com.mim.erp.master;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

import java.io.IOException;

/**
 * Browser-side caching for GET /api/master/*: ETag + "private, no-cache" means the browser keeps a copy
 * and revalidates each time, getting an empty 304 when nothing changed instead of re-downloading
 * megabytes. Spring Security would otherwise stamp these responses "no-store".
 */
@Configuration
public class MasterHttpCache {

    @Bean
    public FilterRegistrationBean<ShallowEtagHeaderFilter> masterEtagFilter() {
        // weak ETag: Tomcat refuses to gzip a response that carries a strong one
        var etag = new ShallowEtagHeaderFilter();
        etag.setWriteWeakETag(true);
        var reg = new FilterRegistrationBean<>(etag);
        reg.addUrlPatterns("/api/master/*");
        reg.setOrder(Ordered.LOWEST_PRECEDENCE - 10);
        return reg;
    }

    @Bean
    public FilterRegistrationBean<OncePerRequestFilter> masterCacheControlFilter() {
        var reg = new FilterRegistrationBean<OncePerRequestFilter>(new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                    throws ServletException, IOException {
                if ("GET".equals(req.getMethod())) {
                    res.setHeader("Cache-Control", "private, no-cache");
                    res.addHeader("Vary", "Authorization");
                }
                chain.doFilter(req, res);
            }
        });
        reg.addUrlPatterns("/api/master/*");
        reg.setOrder(Ordered.LOWEST_PRECEDENCE - 20);
        return reg;
    }
}
