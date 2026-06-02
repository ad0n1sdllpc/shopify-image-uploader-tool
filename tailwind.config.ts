import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#202223",
        moss: "#008060",
        fern: "#95bf47",
        clay: "#d72c0d",
        mist: "#f6f6f7",
        line: "#dfe3e8",
        subdued: "#6d7175",
        surface: "#ffffff",
        canvas: "#f1f2f3"
      },
      boxShadow: {
        soft: "0 1px 0 rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.08)"
      }
    }
  },
  plugins: []
};

export default config;
