"""
End-to-end customer journey test for the local Maison storefront.

Walks one real order through the running storefront and backend:
home -> store -> search -> PDP -> add to cart -> cart -> checkout
(address -> delivery -> payment -> review) -> order confirmation.

Prerequisites:
  - Backend healthy on E2E_BASE_URL's host :9000 (default localhost)
  - Storefront dev server on E2E_BASE_URL (default http://localhost:8000)
  - Python 3.12+ with playwright installed:  pip install playwright && playwright install chromium
  - Seeded catalog with stock (see docs/local-development.md)

Usage:
  python tests/e2e/e2e-journey.py

Environment:
  E2E_BASE_URL       storefront origin (default http://localhost:8000)
  E2E_ARTIFACTS_DIR  where screenshots/result.txt are written
                     (default <repo>/tests/e2e/artifacts, git-ignored)

Exit codes: 0 = journey completed (order confirmed), 1 = failure.

Notes:
  - Every successful run places ONE new pending order with the test buyer
    e2e.buyer@example.com. Orders stay pending/paid_total=0; this environment
    has only the built-in manual payment provider (no real payment processing).
  - The script contains no credentials; the test buyer address is fake data.
"""

import os
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8000").rstrip("/")
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get("E2E_ARTIFACTS_DIR", str(REPO_ROOT / "tests" / "e2e" / "artifacts")))
OUT.mkdir(parents=True, exist_ok=True)

steps = []
console_msgs = []


def log(msg):
    steps.append(msg)
    print(msg, flush=True)


def shot(page, name):
    try:
        page.screenshot(path=str(OUT / f"{name}.png"))
    except Exception as e:
        log(f"  (screenshot {name} failed: {e})")


def dump_state(page, tag):
    log(f"--- state [{tag}] url={page.url}")
    try:
        inputs = page.locator("input, select, textarea")
        n = inputs.count()
        for i in range(min(n, 30)):
            el = inputs.nth(i)
            try:
                desc = el.evaluate(
                    """e => {
                        const id = e.id || ''
                        const name = e.name || ''
                        const ph = e.placeholder || ''
                        const ty = e.type || e.tagName.toLowerCase()
                        const al = e.getAttribute('aria-label') || ''
                        const lb = e.labels && e.labels[0] ? e.labels[0].innerText : ''
                        return `${e.tagName.toLowerCase()} id=${id} name=${name} type=${ty} ph=${ph} al=${al} label=${lb}`
                    }"""
                )
                log(f"  input: {desc}")
            except Exception:
                pass
    except Exception as e:
        log(f"  input dump failed: {e}")
    try:
        btns = page.locator("button:visible")
        for i in range(min(btns.count(), 30)):
            t = btns.nth(i).inner_text().strip().replace("\n", " ")[:60]
            tid = btns.nth(i).get_attribute("data-testid") or ""
            if t or tid:
                log(f"  button: '{t}' testid={tid}")
    except Exception as e:
        log(f"  button dump failed: {e}")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on(
            "console",
            lambda m: console_msgs.append(f"{m.type}: {m.text}")
            if m.type == "error"
            else None,
        )
        page.on("pageerror", lambda e: console_msgs.append(f"pageerror: {e}"))

        # --- 1. Home ---
        page.goto(BASE + "/", wait_until="networkidle", timeout=60000)
        log(f"1 home -> {page.url}")
        assert "/dk" in page.url, "home did not redirect to /dk"
        shot(page, "01-home")

        # --- 2. Store listing (client-rendered via InstantSearch) ---
        page.goto(BASE + "/dk/store", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector('[data-testid="store-search-input"]', timeout=30000)
        page.wait_for_selector('[data-testid="product-wrapper"]', timeout=30000)
        hits = page.locator('[data-testid="product-wrapper"]').count()
        log(f"2 store hits={hits}")
        assert hits > 0, "store listing rendered zero products"
        shot(page, "02-store")

        # --- 3. Search "hoodie" ---
        page.fill('[data-testid="store-search-input"]', "hoodie")
        page.wait_for_function(
            """() => {
                const t = [...document.querySelectorAll('[data-testid="product-title"]')].map(e => e.innerText.toLowerCase())
                return t.length > 0 && t.every(x => x.includes('hoodie'))
            }""",
            timeout=20000,
        )
        hood_hits = page.locator('[data-testid="product-wrapper"]').count()
        titles = page.locator('[data-testid="product-title"]').all_inner_texts()
        log(f"3 search hits={hood_hits} titles={titles[:6]} url={page.url}")
        assert hood_hits > 0 and all("hoodie" in t.lower() for t in titles), "search did not refine to hoodies"
        shot(page, "03-search")

        # --- 4. Open first search hit (PDP) — anchor wraps the card ---
        first_link = page.locator('a[href^="/dk/products/"]').first
        first_link.click()
        page.wait_for_selector('[data-testid="product-container"]', timeout=30000)
        page.wait_for_load_state("networkidle")
        pdp_title = page.locator('[data-testid="product-title"]').first.inner_text()
        log(f"4 pdp '{pdp_title}' -> {page.url}")
        shot(page, "04-pdp")

        # select options until the add button is enabled (multi-variant products)
        add_btn = page.locator('[data-testid="add-product-button"]')
        page.wait_for_timeout(300)
        clicked = 0
        while clicked < 12:
            label = add_btn.inner_text().strip()
            disabled = add_btn.is_disabled()
            log(f"   add-button '{label}' disabled={disabled}")
            if not disabled and label == "Add to cart":
                break
            opt_btns = page.locator('[data-testid="product-options"] button:not([disabled])')
            if opt_btns.count() == 0:
                opt_btns = page.locator('button[data-testid="product-options"]:not([disabled])')
            total = opt_btns.count()
            if total == 0:
                raise AssertionError(f"no option buttons, add label was '{label}'")
            # click each unique option button once, in order, until enabled
            opt_btns.nth(min(clicked, total - 1)).click()
            clicked += 1
            page.wait_for_timeout(250)
        assert add_btn.inner_text().strip() == "Add to cart", "add button never became ready"

        # --- 5. Add to cart ---
        # addToCart is a server action: the browser POSTs to the current page,
        # the server sets _medusa_cart_id on that response. Wait for the POST
        # and then for the cookie, so navigating to /cart can't race the add.
        with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.startswith(BASE),
            timeout=30000,
        ) as resp_info:
            add_btn.click()
        resp = resp_info.value
        assert resp.ok, f"add-to-cart request failed: HTTP {resp.status}"
        deadline = time.time() + 15
        while time.time() < deadline:
            cookies = page.context.cookies(BASE)
            if any(c["name"] == "_medusa_cart_id" and c["value"] for c in cookies):
                break
            page.wait_for_timeout(200)
        else:
            raise AssertionError("_medusa_cart_id cookie never appeared after add-to-cart")
        err = page.locator('[data-testid="add-to-cart-error"]')
        assert err.count() == 0 or not err.first.is_visible(), "add-to-cart error shown"
        log("5 added to cart")
        shot(page, "05-added")

        # --- 6. Cart page ---
        # first visit compiles the route in dev; give it a generous budget and
        # accept the empty-cart sentinel so a real failure is distinct from a timeout
        page.goto(BASE + "/dk/cart", wait_until="domcontentloaded", timeout=90000)
        page.wait_for_selector(
            '[data-testid="product-row"], [data-testid="empty-cart-message"]',
            timeout=90000,
        )
        assert page.locator('[data-testid="empty-cart-message"]').count() == 0, (
            "cart page shows empty-cart-message after successful add"
        )
        row = page.locator('[data-testid="product-row"]').first
        row.wait_for(state="visible", timeout=90000)
        cart_title = row.locator('[data-testid="product-title"]').first.inner_text()
        log(f"6 cart row '{cart_title}'")
        assert cart_title, "cart row has no title"
        shot(page, "06-cart")

        # --- 7. Checkout: address ---
        page.click('[data-testid="checkout-button"]')
        page.wait_for_selector('[data-testid="checkout-container"]', timeout=30000)
        page.wait_for_load_state("networkidle")
        log(f"7 checkout -> {page.url}")
        shot(page, "07-checkout")
        dump_state(page, "address-step")

        # fill address form from the dumped field names
        page.fill('input[name="email"]', "e2e.buyer@example.com")
        for name, value in [
            ("shipping_address.first_name", "E2E"),
            ("shipping_address.last_name", "Buyer"),
            ("shipping_address.company", ""),
            ("shipping_address.address_1", "12 Test Street"),
            ("shipping_address.postal_code", "2100"),
            ("shipping_address.city", "Copenhagen"),
            ("shipping_address.phone", "1234567890"),
        ]:
            sel = f'input[name="{name}"]'
            if page.locator(sel).count():
                page.fill(sel, value)
        country_sel = page.locator('select[name="shipping_address.country_code"]')
        if country_sel.count():
            country_sel.select_option("dk")
        else:
            log("  (no country select found)")
        shot(page, "08-address-filled")
        page.click('[data-testid="submit-address-button"]')
        try:
            page.wait_for_url("**/checkout**step=delivery**", timeout=30000)
        except Exception:
            addr_err = page.locator('[data-testid="address-error-message"]')
            if addr_err.count() and addr_err.first.is_visible():
                log(f"   ADDRESS ERROR: {addr_err.first.inner_text()[:300]}")
            dump_state(page, "address-submit-failed")
            raise
        log(f"8 delivery step -> {page.url}")
        # delivery options hydrate client-side; wait for the radios and capture
        # any client error if they never appear (Next dev shows an error badge)
        try:
            page.wait_for_selector(
                '[data-testid="delivery-option-radio"]', timeout=30000
            )
        except Exception:
            log("   delivery radios never appeared; console tail:")
            for m in console_msgs[-15:]:
                log("   console: " + m[:400])
            html = page.content()
            log("   page html snippet: " + html[html.find("<main") : html.find("<main") + 600].replace("\n", " ") if "<main" in html else "   (no <main>)")
            dump_state(page, "delivery-radios-missing")
            raise
        shot(page, "09-delivery")
        dump_state(page, "delivery-step")

        # --- 8. Shipping option ---
        # HeadlessUI Radio renders as a button, not a native input
        radios = page.locator('[data-testid="delivery-option-radio"]')
        assert radios.count() > 0, "no shipping options rendered"
        # selecting fires a server action that persists the shipping method
        with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.startswith(BASE),
            timeout=30000,
        ) as resp_info:
            radios.first.click()
        assert resp_info.value.ok, f"set-shipping POST failed: HTTP {resp_info.value.status}"
        submit_delivery = page.locator('[data-testid="submit-delivery-option-button"]')
        submit_delivery.wait_for(state="visible", timeout=10000)
        deadline = time.time() + 15
        while submit_delivery.is_disabled() and time.time() < deadline:
            page.wait_for_timeout(200)
        assert not submit_delivery.is_disabled(), "submit-delivery still disabled"
        submit_delivery.click()
        page.wait_for_url("**/checkout**step=payment**", timeout=30000)
        log(f"9 payment step -> {page.url}")
        shot(page, "10-payment")
        dump_state(page, "payment-step")

        # --- 9. Payment ---
        # options are HeadlessUI role=radio buttons; pp_system_default (manual
        # test method) is the only provider configured in this environment
        try:
            page.wait_for_selector('[role="radio"]', timeout=30000)
        except Exception:
            log("   payment radios never appeared; console tail:")
            for m in console_msgs[-15:]:
                log("   console: " + m[:400])
            dump_state(page, "payment-radios-missing")
            raise
        pay_radios = page.locator('[role="radio"]')
        log(f"   payment radios={pay_radios.count()}")
        if pay_radios.count() > 0:
            pay_radios.first.click()
        else:
            log("   (no payment radio — provider may be implicit)")
        shot(page, "10b-payment-selected")
        submit_pay = page.locator('[data-testid="submit-payment-button"]')
        submit_pay.wait_for(state="visible", timeout=10000)
        deadline = time.time() + 15
        while submit_pay.is_disabled() and time.time() < deadline:
            page.wait_for_timeout(200)
        submit_pay.click()
        page.wait_for_url("**/checkout**step=review**", timeout=30000)
        log(f"10 review step -> {page.url}")
        shot(page, "11-review")

        # --- 10. Place order ---
        page.click('[data-testid="submit-order-button"]')
        page.wait_for_url("**/order/**/confirmed**", timeout=60000)
        log(f"11 ORDER CONFIRMED -> {page.url}")
        shot(page, "12-confirmed")
        order_id = page.url.split("/order/")[1].split("/")[0]
        log(f"order_id={order_id}")

        if console_msgs:
            log("console errors:")
            for m in console_msgs[:20]:
                log("  " + m[:300])

        browser.close()
        return order_id


try:
    order_id = run()
    with open(OUT / "result.txt", "w") as f:
        f.write("OK " + order_id)
    log("E2E RESULT: OK " + order_id)
    sys.exit(0)
except Exception:
    log("E2E RESULT: FAIL")
    traceback.print_exc()
    log("console messages tail:")
    for m in console_msgs[-20:]:
        log("  " + m[:300])
    with open(OUT / "result.txt", "w") as f:
        f.write("FAIL\n" + "\n".join(steps[-30:]))
    sys.exit(1)
