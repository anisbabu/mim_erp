package com.mim.erp.master;

import java.util.*;
import java.util.regex.*;

/**
 * Parses a product full-name / display-name into structured fields.
 *
 * <p>Typical BOARD patterns:
 * <ul>
 *   <li>{@code 18MM RED OAK MELAMINE (AHMED)}      → thickness=18, color=RED OAK, category=MELAMINE</li>
 *   <li>{@code 18MM PVC PROME TEAK 731 (SUPER)}    → thickness=18, category=PVC, color=PROME TEAK</li>
 *   <li>{@code 18MM MDF OAK B/S (SUPER)}           → thickness=18, category=MDF, color=OAK, side=B/S</li>
 *   <li>{@code .5X22 EDGING BURMA TEAK}            → edgingSize=.5X22, category=EDGING, color=BURMA TEAK</li>
 * </ul>
 */
public class ProductNameParser {

    // Categories sorted longest-first so "ACRYLIC SHEET" matches before shorter substrings
    private static final List<String> CATEGORIES = List.of(
        "ACRYLIC SHEET", "LOOSE VENEER", "MELAMINE", "FORMICA", "ELEGANT",
        "EDGING", "VENEER", "MDF", "PLY", "HPL", "PVC"
    );

    // Known colors across all categories – sorted longest-first
    private static final List<String> COLORS;
    static {
        Set<String> set = new LinkedHashSet<>();
        Collections.addAll(set,
            // MELAMINE
            "ALBINO OAK", "ALVINO OAK", "AMBER OAK", "AMBER SILK", "AMBER SPECIAL TEAK",
            "AMBER TEAK", "AMERICAN TEAK", "AMERICAN WALNUT", "ANATUR", "ANATURE", "ANTIC",
            "ANTIC EMBER GLOSSY", "ANTIC EMBER MAT", "ARCTIC IVORY GLOSSY", "ARCTIC IVORY LBA",
            "ARCTIC IVORY MAT", "ARIT", "ARKANSAS", "ARTIFACT", "AURORA GLOW GLOSSY",
            "AURORA GLOW MAT", "BASALT ROCK GLOSSY", "BEECH", "BLACK AMBUSH",
            "BLACK OAK 734", "BLACK OAK", "BLACK WENGE", "BLACK WOOD", "BLACK",
            "BLUE", "BRAWON CARPET", "BURMA TEAK", "CANADIAN TEAK", "CARAMEL",
            "CARTOON-2", "CATANIA OAK", "CEDER", "CHEERY", "CHERRY", "CHESSNUT",
            "CHINA WALNUT", "CHINESE TEAK", "CHOCOLATIC", "CHOCOLETIC",
            "CLASSIC WOOD GLOSSY", "CLASSIC WOOD MAT", "CLOUDY CAMRIC",
            "COAST LINE", "COST LINE", "CRAFT CANVAS", "CROWN OAK", "CRYSTAL MARBLE",
            "CTG TAEK", "CTG TEAK", "DALIYA", "DARK OAK", "DARK WALNUT", "DEEP CHEERY",
            "DEEP CHERRY", "DEEP WALNUT", "EBONY", "ECLIPSE MATTE GLOSSY", "ECLIPSE MATTE MAT",
            "ELEGANCE OAK", "FEBRIC", "FOZIL OAK", "FROZEN STONE", "GARNET GRAIN GLOSSY",
            "GARNET GRAIN MAT", "GOLD WOOD", "GOLDEN FLOWER", "GOLDEN FLOWRRY",
            "GOLDEN FOLLWARY", "GOLDEN OAK", "GOLDEN TEAK", "GOLDEN WOOD", "GRAPHITE MAT",
            "GRAPHITE", "GREEN", "GREY GLOSSY", "GREY MARBLE", "GREY MAT", "GREY",
            "HAVANA OAK", "IMPERIAL TEAK GLOSSY", "JAPANESE SILK", "JAPANIC SLIK",
            "JET BLACK GLOSSY", "KANADIAN PAINE", "KHAN TEAK", "LIGHT CHERRY", "LIGHT GREY",
            "LIGHT WOOD", "LUNAR FROST GLOSSY", "LUNAR FROST LBA", "MAPEL", "MAPLE",
            "MARBLE", "MAXCICAN OAK", "MAXICAN OAK", "MEHAGONI", "MEHOGONI", "MEHOGONY",
            "MEHOGUNI", "METALIC", "METALLIC", "MIDNIGHT BLACK GLOSSY", "MIDNIGHT BLACK LBA",
            "MIDNIGHT BLACK MAT", "MILKWAY MAT", "MILKYWAY GLOSSY", "MILKYWAY MAT",
            "MIOST TEAK", "MOIST TEAK", "MONUMENT OAK", "NEBULA MIST GLOSSY",
            "NEBULA MIST MAT", "NEW TEAK", "NIJARIAN TEAK", "NIZERIAN TEAK",
            "NORDIC BIRCH GLOSSY", "OAK PATCH", "OAK", "ORANGE CIRCLE", "ORANGE",
            "P.GREEN", "PAPAI", "PAROT GREEN", "PARROT GREEN", "PEARL MARBLE GREY",
            "PEARL WHITE", "PEOGOUT MARBLE-4", "PEUEOT MARBLE-4", "PINK WAVE",
            "PINK/GOLAPI", "PLY BLACK", "PREMIUM TEAK", "PROME TAEK", "PROME TEAK 3D",
            "PROME TEAK", "PROVATI -36", "PURPLE PEARL", "PURPLE", "QUEEN FOLLOWRY",
            "QUEEN FOLLWORY", "RED ARTIFACT", "RED MARBLE", "RED OAK CROWN", "RED OAK",
            "RED", "REGULAR WHITE GLOSSY", "REGULAR WHITE MAT", "ROCKY OAK", "ROSE WOOD",
            "ROYAL CROWN", "SANI TEAK", "SANTANA OAK", "SHADI TEAK", "SHADY TEAK",
            "SHAN TAEK", "SHAN TEAK", "SHANI WOOD", "SHINE WOOD", "SHOYKAT", "SILK LINE",
            "SILK", "SILKY BLACK", "SILKY BROWN", "SILVER GREY", "SILVER LINE", "SILVER OAK",
            "SMOKE", "SOIKAT", "SOLAR FLARE GLOSSY", "SOLAR FLARE MAT", "SOLIA OAK CLAY",
            "SONALI", "SONOMA OAK MAT", "SONOMA OAK", "SPACE BLACK GLOSSY", "SPACE BLACK MAT",
            "SPACE GREY GLOSSY", "SPACE GREY LBA", "SPACE GREY MAT", "SPAIDER",
            "SPANISH OAK", "SPECIAL TEAK", "STARLIGHT GLOSSY", "STARLIGHT MAT", "SUBORNO",
            "SUN T/BROWN CARPET", "SUPER OAK", "SUPER", "SWICH SILK", "TEAK SPECIAL",
            "TECTONIC CLAY LBA", "WALNUT", "WENGE", "WHITE 22", "WHITE BEECH",
            "WHITE CAMBRICK", "WHITE CASTLE", "WHITE CEDAR", "WHITE CEDER", "WHITE GLOSSY",
            "WHITE MARBLE", "WHITE MAT", "WHITE OAK", "WHITE TEAK", "WHITE WALNUT", "WHITE",
            "WILLOW", "WOOD BLACK", "WOOD GRAIN WHITE", "WOODEN RING", "YELLOW", "ZEBRA LINE",
            "ZEN TEAK",
            // PLY
            "ACRYLIC", "ARTIFICIAL", "ARTIFICIYAL", "ASH", "BROWN", "BURL",
            "BURMATEAK", "BURMA TEAK LINE", "CHAPELI", "CHAPILI", "COMMERCIAL",
            "CROWNTEAK", "EBONI", "ENGINEERING", "GARJON", "GOLD", "GP", "MARINE",
            "NUT", "RETARDANT", "RICON", "RO", "ROYAL", "ROYALE", "SAPELLI",
            "SHATARING", "SHUTERING", "SHUTTERING", "ST", "TEAK", "WALLNUT",
            // PVC
            "CHASTNUT", "COFFEE", "CROWN", "ECO", "LUMBER", "MAHOGANY", "NATURAL",
            "PINK", "PREMIUM", "TOUCH WOOD", "WOOD", "WOODEN",
            // FORMICA
            "MILK WHITE", "WHITE SUEDE",
            // PLY extras
            "AMBLE TEAK", "STAR TEAK", "BLANCO MARBLE-3",
            // extras
            "BURMA APPALE", "PENCIL TEAK", "WHITE (103) (0.7) GLOSSY", "WHITE (103) (0.7) MAT",
            "GRAPHITE (111) (0.7) MAT"
        );
        // Sort longest first
        List<String> sorted = new ArrayList<>(set);
        sorted.sort((a, b) -> Integer.compare(b.length(), a.length()));
        COLORS = Collections.unmodifiableList(sorted);
    }

    public record ParsedName(
        Double thicknessMm,
        String edgingSize,
        String category,
        String color,
        String side,
        String supplierHint
    ) {}

    /**
     * Parse a raw product name into structured fields.
     * Returns null if nothing useful could be extracted.
     */
    public static ParsedName parse(String raw) {
        if (raw == null || raw.isBlank()) return null;

        Double thicknessMm = null;
        String edgingSize = null;
        String category = null;
        String color = null;
        String side = null;
        String supplierHint = null;

        // Normalise
        String text = raw.toUpperCase().replaceAll("\\s+", " ").trim();

        // Remove leading noise like "(AMBER)" before the thickness
        text = text.replaceAll("^\\([^)]*\\)\\s*", "");

        // 1. Extract supplier from trailing parentheses
        Matcher supMatcher = Pattern.compile("\\(([^)]+)\\)\\s*$").matcher(text);
        if (supMatcher.find()) {
            supplierHint = supMatcher.group(1).trim().split("\\s+")[0];
            text = text.substring(0, supMatcher.start()).trim();
        }

        // 2. Extract side: O/S or B/S
        Matcher sideMatcher = Pattern.compile("\\b([OB]/S)\\b").matcher(text);
        if (sideMatcher.find()) {
            side = sideMatcher.group(1);
            text = (text.substring(0, sideMatcher.start()) + " " + text.substring(sideMatcher.end())).replaceAll("\\s+", " ").trim();
        }

        // 3. Extract thickness
        Matcher thickMatcher = Pattern.compile("^(\\d+(?:\\.\\d+)?)\\s*MM\\b", Pattern.CASE_INSENSITIVE).matcher(text);
        if (thickMatcher.find()) {
            thicknessMm = Double.parseDouble(thickMatcher.group(1));
            text = text.substring(thickMatcher.end()).trim();
        }
        if (thicknessMm == null) {
            Matcher edgeMatcher = Pattern.compile("^(\\.?\\d+X\\d+)\\b", Pattern.CASE_INSENSITIVE).matcher(text);
            if (edgeMatcher.find()) {
                edgingSize = edgeMatcher.group(1);
                category = "EDGING";
                text = text.substring(edgeMatcher.end()).trim();
            }
        }

        // 4. Extract category
        if (category == null) {
            for (String cat : CATEGORIES) {
                Pattern catPattern = Pattern.compile("\\b" + Pattern.quote(cat) + "\\b");
                Matcher catMatcher = catPattern.matcher(text);
                if (catMatcher.find()) {
                    category = cat;
                    text = (text.substring(0, catMatcher.start()) + " " + text.substring(catMatcher.end())).replaceAll("\\s+", " ").trim();
                    break;
                }
            }
        }

        // 5. Extract color
        // Remove numeric codes, UV prefix, and noise words
        text = text.replaceAll("\\b\\d{2,4}\\b", " ")
                   .replaceAll("\\bUV\\b", " ")
                   .replaceAll("\\bECO\\b", " ")
                   .replaceAll("\\bSONALI\\b", " ")
                   .replaceAll("\\bHOTSTAMPING\\b", " ")
                   .replaceAll("\\s+", " ").trim();

        if (!text.isEmpty()) {
            for (String c : COLORS) {
                Pattern colorPattern = Pattern.compile("\\b" + Pattern.quote(c) + "\\b");
                if (colorPattern.matcher(text).find()) {
                    color = c;
                    break;
                }
            }
            if (color == null && !text.isEmpty()) {
                String cleaned = text
                    .replaceAll("\\bBOARD\\b", "")
                    .replaceAll("\\bPLAIN\\b", "")
                    .replaceAll("\\bCODE\\b", "")
                    .replaceAll("\\bCD-?\\s*", "")
                    .replaceAll("\\bFIVER\\b", "")
                    .replaceAll("\\b[A-Z]?\\d+\\b", "")
                    .replaceAll("\\s+", " ").trim();
                if (!cleaned.isEmpty()) color = cleaned;
            }
        }

        if (thicknessMm != null || edgingSize != null || category != null || color != null || side != null) {
            return new ParsedName(thicknessMm, edgingSize, category, color, side, supplierHint);
        }
        return null;
    }
}
