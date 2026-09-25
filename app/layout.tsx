import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-geist-mono" });

export const metadata = { title: "Health Coach Agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes ставит класс .dark на <html> до гидрации.
    <html lang="ru" className={cn(sans.variable, mono.variable, "font-sans antialiased")} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
