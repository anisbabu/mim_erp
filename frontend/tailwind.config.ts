import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",                       // slate-900, primary text
        brand: { DEFAULT: "#0f766e", dark: "#0b5e57", soft: "#e6f2f0" }, // refined teal-green
        ash: "#f1f5f9",                        // slate-100 sidebar
        ashdark: "#e2e8f0",                    // slate-200
        line: "#e8edf2",
        amberwarn: "#b45309",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Segoe UI", "Hind Siliguri", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)",
        pop: "0 10px 30px rgba(15,23,42,.12)",
      },
    },
  },
  plugins: [],
};
export default config;
