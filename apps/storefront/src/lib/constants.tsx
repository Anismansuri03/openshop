import { CreditCard } from "@medusajs/icons"
import Bancontact from "@modules/common/icons/bancontact"
import Ideal from "@modules/common/icons/ideal"
import PayPal from "@modules/common/icons/paypal"
import React from "react"

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  pp_stripe_stripe: {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_medusa-payments_default": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_stripe-ideal_stripe": {
    title: "iDeal",
    icon: <Ideal />,
  },
  "pp_stripe-bancontact_stripe": {
    title: "Bancontact",
    icon: <Bancontact />,
  },
  pp_paypal_paypal: {
    title: "PayPal",
    icon: <PayPal />,
  },
  pp_system_default: {
    title: "Manual Payment",
    icon: <CreditCard />,
  },
  "pp_dev-payment_default": {
    title: "Development Payment (test only)",
    icon: <CreditCard />,
  },
  // OpenShop payment simulator (G2): deterministic, credential-free,
  // cannot move money. Always visibly marked test-only (never presented
  // as a real provider). See docs/PAYMENTS.md.
  "pp_sim-payment_default": {
    title: "Simulated Payment (test only)",
    icon: <CreditCard />,
  },
  // Add more payment providers here
}

// This only checks if it is native stripe or medusa payments for card payments, it ignores the other stripe-based providers
export const isStripeLike = (providerId?: string) => {
  return (
    providerId?.startsWith("pp_stripe_") || providerId?.startsWith("pp_medusa-")
  )
}

export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}

// OpenShop development payment provider (G5): simulates payments only,
// never processes real money. See docs/PAYMENTS.md.
export const isDevPayment = (providerId?: string) => {
  return providerId?.startsWith("pp_dev-payment_")
}

// OpenShop payment simulator (G2): same guarantee as the development
// provider — simulated only, no credentials, no real money.
export const isSimPayment = (providerId?: string) => {
  return providerId?.startsWith("pp_sim-payment_")
}

// Any provider that must be visibly marked as test-only in checkout
// (the manual test provider, the development payment provider, or the
// payment simulator).
export const isTestPayment = (providerId?: string) => {
  return isManual(providerId) || isDevPayment(providerId) || isSimPayment(providerId)
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]
