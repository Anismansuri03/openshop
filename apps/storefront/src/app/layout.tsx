import { getBaseURL } from "@lib/util/env"
import { Inter, Bodoni_Moda } from "next/font/google"
import { Metadata } from "next"
import "styles/globals.css"

// Self-hosted via next/font — no runtime requests to Google.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

const bodoniModa = Bodoni_Moda({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-display",
})

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  title: {
    default: "Maison",
    template: "%s — Maison",
  },
  description:
    "A house of considered garments — everyday pieces cut for long wear.",
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-mode="light"
      className={`${inter.variable} ${bodoniModa.variable}`}
    >
      <body>
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
