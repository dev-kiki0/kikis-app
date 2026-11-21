import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'KikisApp — Unified Agent Payment Execution on Stellar',
    template: '%s | KikisApp',
  },
  description:
    'x402, MPP charge, MPP session, and MPP session over WebSocket — unified behind client.pay(url). One interface. Four payment modes. Zero hardcoding.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.kikis-app.xyz'),
  openGraph: {
    title: 'KikisApp — Unified Agent Payment Execution on Stellar',
    description: 'One SDK for x402, MPP charge, MPP session, and MPP session over WebSocket on Stellar. Agents pay for services with a single function call.',
    siteName: 'KikisApp',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'KikisApp — unified agent payment execution on Stellar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KikisApp',
    description: 'Unified payment execution for autonomous agents on Stellar.',
    images: ['/og.png'],
  },
  icons: {
    icon: '/logo.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          storageKey="kikis-app-theme"
          enableSystem={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
