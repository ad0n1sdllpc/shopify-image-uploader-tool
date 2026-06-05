import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopify Image Uploader",
  description: "Local visual uploader for Shopify product images"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                try {
                  const mode = localStorage.getItem("image-uploader-theme") || "system";
                  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                  const dark = mode === "dark" || (mode === "system" && prefersDark);
                  document.documentElement.classList.toggle("dark", dark);
                  document.documentElement.style.colorScheme = dark ? "dark" : "light";
                } catch {}
              })();
            `
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
