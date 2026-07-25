import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/pullsrc/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const erode = localFont({
  src: "../../public/font/Erode/Fonts/WEB/fonts/Erode-Regular.woff2",
  variable: "--font-erode",
  weight: "400",
  style: "normal",
  display: "swap",
});

const tanker = localFont({
  src: "../../public/font/Tanker/Fonts/WEB/fonts/Tanker-Regular.woff2",
  variable: "--font-tanker",
  weight: "400",
  style: "normal",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TAGLINE = "Every asset, one paste.";
const DESCRIPTION =
  "Paste any webpage URL and instantly extract images, fonts, colors, videos, and 3D models with credit details for your next design or build.";

export const metadata: Metadata = {
  metadataBase: new URL("https://pullsrc.byavi.in"),
  applicationName: "PullSRC",
  title: {
    default: `PullSRC — ${TAGLINE}`,
    template: "%s — PullSRC",
  },
  description: DESCRIPTION,
  keywords: [
    "website asset extractor",
    "pull assets from any website",
    "download design assets from url",
    "extract images from website",
    "download video from website",
    "extract fonts from website",
    "website color palette extractor",
    "extract logo from website",
    "extract icons from website",
    "download HLS video m3u8",
    "web asset scraper",
    "design asset extractor",
    "download webpage media",
    "source and credit media from website",
    "paste url get assets",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `PullSRC — ${TAGLINE}`,
    description: DESCRIPTION,
    siteName: "PullSRC",
    type: "website",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PullSRC — Every asset, one paste.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `PullSRC — ${TAGLINE}`,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${erode.variable} ${tanker.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta name="apple-mobile-web-app-title" content="PullSRC" />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="flex min-h-screen flex-1 flex-col">
            {children}
            <footer className="mt-auto px-4 py-4 text-center text-sm text-muted-foreground bg-transparent">
              Built by <a href="https://byavi.in" target="_blank" rel="noreferrer" className="font-medium text-foreground transition hover:opacity-80">byavi.in</a>
            </footer>
          </div>
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
