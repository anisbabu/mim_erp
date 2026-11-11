package com.mim.erp.audit;

import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;

import javax.sql.DataSource;

@Configuration
public class AuditConfig {

    /** Wraps the application's DataSource so every connection carries the acting user. */
    @Bean
    public static BeanPostProcessor auditDataSourceWrapper() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(@NonNull Object bean, @NonNull String beanName) {
                if (bean instanceof DataSource ds && !(bean instanceof AuditDataSource)) return new AuditDataSource(ds);
                return bean;
            }
        };
    }
}
