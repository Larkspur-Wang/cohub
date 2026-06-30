# Work Commerce Demo

This demo shows the smallest recommended purchase and consumption flow inside a Cohub Work.

## Best practice

1. Hardcode a known `productKey` and `benefitKey` in the Work.
2. Resolve product details through `cohub.work.commerce.resolveProducts()`.
3. Check viewer entitlements and credit balance through `cohub.work.commerce.getEntitlements()`.
4. Start checkout through `cohub.work.commerce.purchase()`.
5. Read the return state through `cohub.work.commerce.getCheckoutState()`.
6. If an `orderId` is present, query the order again through `cohub.work.commerce.getOrder(orderId)`.
7. When the user performs a metered action, consume credits through `cohub.work.commerce.consumeCredits()`.

The outer host owns:

- sign-in
- checkout confirmation UI
- top-level redirect to the provider
- pending order cache
- return URL parsing

The Work owns:

- product selection
- entitlement-aware UI
- credit balance display and consumption
- order-specific post-checkout messaging

## Prepare with the CLI

Commerce is configured on the Space, then consumed by the Work.

### Feature benefit example

```bash
# Use -s or COHUB_SPACE_ID to target the Space.
cohub -s <space-id> spaces commerce setup

# Keys are generated from names: "Space Pro" -> space_pro, "Pro Unlock" -> pro_unlock.
cohub -s <space-id> spaces commerce benefits create \
  --name "Space Pro"

cohub -s <space-id> spaces commerce products create \
  --name "Pro Unlock" \
  --amount-usd 9.99 \
  --visibility public \
  --status active

cohub -s <space-id> spaces commerce bind \
  --product-key pro_unlock \
  --benefit-key space_pro
```

### Credit benefit example

```bash
cohub -s <space-id> spaces commerce benefits create \
  --type credits \
  --name "500 Credits" \
  --amount 500 \
  --expires-in-days 365

cohub -s <space-id> spaces commerce products create \
  --name "Credit Pack" \
  --amount-usd 4.99 \
  --visibility public \
  --status active

cohub -s <space-id> spaces commerce bind \
  --product-key credit_pack \
  --benefit-key 500_credits
```

Useful inspection commands:

```bash
cohub -s <space-id> spaces commerce products list
cohub -s <space-id> spaces commerce benefits list
cohub -s <space-id> spaces commerce orders list --limit 10
```

## Operate a published Work

Use the Work commerce commands to test the full server-side flow.

```bash
cohub works commerce products resolve \
  --work-id <work-id> \
  --product-key pro_unlock

cohub works commerce entitlements \
  --work-id <work-id>

cohub works commerce credits consume \
  --work-id <work-id> \
  --amount 100 \
  --reason "High-res export"

cohub works commerce purchase \
  --work-id <work-id> \
  --product-key pro_unlock

cohub works commerce orders get \
  --work-id <work-id> \
  --order-id <order-id>
```

## Minimal example

```html
<script type="module">
  const { createCohubClient } = await import("https://esm.sh/@neta-art/cohub?bundle&target=es2022");

  const cohub = createCohubClient();
  const PRODUCT_KEY = "pro_unlock";
  const BENEFIT_KEY = "space_pro";

  const productEl = document.getElementById("product");
  const statusEl = document.getElementById("status");
  const buyBtn = document.getElementById("buy");

  async function load() {
    const [{ products }, { entitlements, credits }, checkoutState] = await Promise.all([
      cohub.work.commerce.resolveProducts({ productKeys: [PRODUCT_KEY] }),
      cohub.work.commerce.getEntitlements(),
      cohub.work.commerce.getCheckoutState(),
    ]);

    const product = products[0] ?? null;
    const entitled = entitlements.some((item) => item.benefitKey === BENEFIT_KEY && item.enabled);

    if (product) {
      productEl.textContent = `${product.name} · $${product.pricing.amountUsd.toFixed(2)}`;
    } else {
      productEl.textContent = "Product unavailable";
      buyBtn.disabled = true;
    }

    if (entitled) {
      statusEl.textContent = "Unlocked";
      buyBtn.disabled = true;
      buyBtn.textContent = "Already unlocked";
      return;
    }

    if (checkoutState.status && checkoutState.orderId) {
      const { order } = await cohub.work.commerce.getOrder(checkoutState.orderId);
      statusEl.textContent = `Checkout ${checkoutState.status} · ${order.status}`;
    } else if (checkoutState.status) {
      statusEl.textContent = `Checkout ${checkoutState.status}`;
    } else {
      statusEl.textContent = "Locked";
    }
  }

  buyBtn.onclick = async () => {
    buyBtn.disabled = true;
    try {
      const checkout = await cohub.work.commerce.purchase({ productKey: PRODUCT_KEY });
      if (!checkout?.checkoutUsable) {
        statusEl.textContent = checkout?.message ?? "Checkout unavailable";
      }
    } catch (error) {
      statusEl.textContent = error instanceof Error ? error.message : "Purchase failed";
    } finally {
      buyBtn.disabled = false;
    }
  };

  load().catch((error) => {
    statusEl.textContent = error instanceof Error ? error.message : "Failed to load";
  });
</script>

<div id="product">Loading…</div>
<div id="status">Loading…</div>
<button id="buy">Buy</button>
```

## Credit consumption example

```ts
const result = await cohub.work.commerce.consumeCredits({
  amount: 10,
  operationId: crypto.randomUUID(),
  reason: "Export high-res image",
});

if (result.status === "insufficient") {
  // Prompt user to purchase a credit pack
}
```

## Notes

- Do not cache order state only inside the iframe.
- Treat `purchase()` as a user action that may redirect away immediately.
- Treat `getCheckoutState()` as a transient signal from the outer host.
- Treat `getOrder(orderId)` as the authoritative order-specific follow-up check.
- Always pass a unique `operationId` to `consumeCredits()` for idempotent retries.
- Keep Work copy simple and short.
- Keep Space setup explicit in scripts: use `-s <space-id>` or `COHUB_SPACE_ID`.
