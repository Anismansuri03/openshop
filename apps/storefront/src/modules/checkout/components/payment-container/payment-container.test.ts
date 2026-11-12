import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { RadioGroup } from "@headlessui/react"
import { describe, expect, it, vi } from "vitest"

import PaymentContainer from "./index"

const paymentInfoMap = {
  pp_system_default: { title: "Manual Payment", icon: React.createElement("span", null, "M") },
  pp_stripe_stripe: { title: "Credit card", icon: React.createElement("span", null, "C") },
} as unknown as Parameters<typeof PaymentContainer>[0]["paymentInfoMap"]

const render = (paymentProviderId: string) =>
  renderToStaticMarkup(
    React.createElement(
      RadioGroup,
      { value: paymentProviderId, onChange: () => {} },
      React.createElement(PaymentContainer, {
        paymentProviderId,
        selectedPaymentOptionId: paymentProviderId,
        paymentInfoMap,
        disabled: false,
      })
    )
  )

describe("PaymentContainer test-mode badge", () => {
  // Regression: the badge used to be gated on NODE_ENV === "development",
  // so production builds showed the manual test provider as if it were a
  // real payment method. It must show for the test provider in every env.
  it("shows the testing-only badge for pp_system_default", () => {
    const html = render("pp_system_default")
    expect(html).toContain("For testing purposes")
    expect(html).toContain("Manual Payment")
  })

  it("does not show the badge for a real provider id", () => {
    const html = render("pp_stripe_stripe")
    expect(html).not.toContain("For testing purposes")
    expect(html).toContain("Credit card")
  })

  it("badge visibility does not depend on NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production")
    try {
      expect(render("pp_system_default")).toContain("For testing purposes")
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
