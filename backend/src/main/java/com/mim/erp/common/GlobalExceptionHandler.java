package com.mim.erp.common;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String,Object>> handleApi(ApiException ex) {
        return ResponseEntity.unprocessableEntity().body(Map.of(
            "timestamp", Instant.now().toString(),
            "error", "business_rule",
            "message", ex.getMessage()
        ));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String,Object>> handleBad(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(Map.of(
            "timestamp", Instant.now().toString(),
            "error", "bad_request",
            "message", ex.getMessage()
        ));
    }
}
