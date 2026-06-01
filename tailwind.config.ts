import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17201b",
        moss: "#37543d",
        fern: "#5d7f55",
        clay: "#b25d43",
        mist: "#f5f7f2"
      },
      boxShadow: {
        soft: "0 14px 40px rgba(23,32,27,0.10)"
      }
    }
  },
  plugins: []
};

export default config;
