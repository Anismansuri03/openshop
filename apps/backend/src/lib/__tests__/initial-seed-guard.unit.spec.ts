import {
  evaluateInitialSeedGuard,
  STARTER_PRODUCT_COUNT,
} from "../initial-seed-guard"

describe("evaluateInitialSeedGuard", () => {
  it("runs when neither store nor region exists", () => {
    const decision = evaluateInitialSeedGuard({ stores: 0, regions: 0, products: 0 })
    expect(decision.action).toBe("run")
  })

  it("stops when regions exist without a store (would duplicate regions)", () => {
    const decision = evaluateInitialSeedGuard({ stores: 0, regions: 2, products: 0 })
    expect(decision.action).toBe("stop")
    expect(decision.reason).toContain("duplicate")
  })

  it("skips when a complete seed is already present", () => {
    const decision = evaluateInitialSeedGuard({
      stores: 1,
      regions: 1,
      products: STARTER_PRODUCT_COUNT,
    })
    expect(decision.action).toBe("skip")
  })

  it("skips when extra demo products were added after the seed", () => {
    const decision = evaluateInitialSeedGuard({ stores: 1, regions: 1, products: 54 })
    expect(decision.action).toBe("skip")
  })

  it("stops when a store exists but regions are missing (partial seed)", () => {
    const decision = evaluateInitialSeedGuard({ stores: 1, regions: 0, products: 4 })
    expect(decision.action).toBe("stop")
    expect(decision.reason).toContain("duplicate")
  })

  it("stops when starter products are missing (partial seed)", () => {
    const decision = evaluateInitialSeedGuard({
      stores: 1,
      regions: 1,
      products: STARTER_PRODUCT_COUNT - 1,
    })
    expect(decision.action).toBe("stop")
  })

  it("never suggests re-running blindly: every stop reason names the counts", () => {
    const decision = evaluateInitialSeedGuard({ stores: 2, regions: 1, products: 1 })
    expect(decision.action).toBe("stop")
    expect(decision.reason).toMatch(/stores=\d+, regions=\d+, products=\d+/)
  })
})
