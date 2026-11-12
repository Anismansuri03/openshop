import {
  createTaxRateValidationMiddleware,
  validateTaxRateBody,
  validateTaxRateValue,
  type TaxRateRequest,
  type TaxRateResponse,
} from "../tax-rate-validation"

function makeResponse() {
  const state = { statusCode: 0, body: undefined as unknown }
  const res: TaxRateResponse = {
    status(code) {
      state.statusCode = code
      return res
    },
    json(body) {
      state.body = body
      return body
    },
  }
  return { res, state }
}

describe("validateTaxRateValue", () => {
  it("accepts omitted and null rates (exempt / zero-rated lines)", () => {
    expect(validateTaxRateValue(undefined)).toBeNull()
    expect(validateTaxRateValue(null)).toBeNull()
  })

  it("accepts boundary and typical rates", () => {
    expect(validateTaxRateValue(0)).toBeNull()
    expect(validateTaxRateValue(19)).toBeNull()
    expect(validateTaxRateValue(100)).toBeNull()
    expect(validateTaxRateValue(8.25)).toBeNull()
  })

  it("rejects negative rates", () => {
    const message = validateTaxRateValue(-5)
    expect(message).toContain("between 0 and 100")
    expect(message).toContain("-5")
  })

  it("rejects rates above 100", () => {
    const message = validateTaxRateValue(150)
    expect(message).toContain("between 0 and 100")
    expect(message).toContain("150")
  })

  it("rejects non-numeric values", () => {
    expect(validateTaxRateValue("19")).toContain("must be a number")
    expect(validateTaxRateValue(NaN)).toContain("must be a number")
    expect(validateTaxRateValue(Infinity)).toContain("must be a number")
    expect(validateTaxRateValue(true)).toContain("must be a number")
  })
})

describe("validateTaxRateBody", () => {
  it("passes through bodies without a rate", () => {
    expect(validateTaxRateBody(undefined)).toBeNull()
    expect(validateTaxRateBody({})).toBeNull()
    expect(validateTaxRateBody({ name: "VAT", code: "VAT" })).toBeNull()
  })

  it("validates the top-level rate (tax-rate create/update)", () => {
    expect(validateTaxRateBody({ rate: 19 })).toBeNull()
    expect(validateTaxRateBody({ rate: -1 })).toContain("between 0 and 100")
    expect(validateTaxRateBody({ rate: 101 })).toContain("between 0 and 100")
  })

  it("validates the nested default rate (tax-region create)", () => {
    expect(validateTaxRateBody({ default_tax_rate: { rate: 19 } })).toBeNull()
    expect(
      validateTaxRateBody({ default_tax_rate: { rate: -0.5 } })
    ).toContain("between 0 and 100")
    // Nested rate omitted is fine; the nested object may carry only name/code.
    expect(validateTaxRateBody({ default_tax_rate: { name: "VAT" } })).toBeNull()
  })

  it("reports the top-level violation first", () => {
    const message = validateTaxRateBody({
      rate: -1,
      default_tax_rate: { rate: 200 },
    })
    expect(message).toContain("-1")
  })
})

describe("createTaxRateValidationMiddleware", () => {
  it("calls next() for a valid body", () => {
    const { res, state } = makeResponse()
    let nextCalls = 0
    createTaxRateValidationMiddleware()(
      { body: { rate: 19 } } as TaxRateRequest,
      res,
      () => {
        nextCalls++
      }
    )
    expect(nextCalls).toBe(1)
    expect(state.statusCode).toBe(0)
  })

  it("responds 400 with Medusa error shape for an out-of-range rate", () => {
    const { res, state } = makeResponse()
    let nextCalls = 0
    createTaxRateValidationMiddleware()(
      { body: { rate: -5 } } as TaxRateRequest,
      res,
      () => {
        nextCalls++
      }
    )
    expect(nextCalls).toBe(0)
    expect(state.statusCode).toBe(400)
    expect(state.body).toMatchObject({ type: "invalid_data" })
    // The message must name the range and the offending value.
    expect((state.body as { message: string }).message).toContain("between 0 and 100")
    expect((state.body as { message: string }).message).toContain("-5")
  })

  it("responds 400 for a bad nested default rate on tax-region create", () => {
    const { res, state } = makeResponse()
    createTaxRateValidationMiddleware()(
      { body: { default_tax_rate: { rate: 250 } } } as TaxRateRequest,
      res,
      () => {
        throw new Error("next() must not be called")
      }
    )
    expect(state.statusCode).toBe(400)
    expect((state.body as { message: string }).message).toContain("250")
  })

  it("passes bodies without any rate field", () => {
    const { res } = makeResponse()
    let nextCalls = 0
    createTaxRateValidationMiddleware()(
      { body: {} } as TaxRateRequest,
      res,
      () => {
        nextCalls++
      }
    )
    expect(nextCalls).toBe(1)
  })
})
