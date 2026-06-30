# Work Commerce Demo

This demo shows the smallest recommended purchase flow inside a Cohub Work.

## Best practice

1. Hardcode a known `productKey` and `benefitKey` in the Work.
2. Resolve product details through `cohub.work.commerce.resolveProducts()`.
3. Check viewer entitlements through `cohub.work.commerce.checkEntitlements()`.
4. Start checkout through `cohub.work.commerce.purchase()`.
5. Read the return state through `cohub.work.commerce.getCheckoutState()`.
6. If an `orderId` is present, query the order again through `cohub.work.commerce.getOrder(orderId)`.

The outer host owns:

- sign-in
- checkout confirmation UI
- top-level redirect to the provider
- pending order cache
- return URL parsing

The Work owns:

- product selection
- entitlement-aware UI
- order-specific post-checkout messaging

## Prepare with the CLI

Commerce is configured on the Space, then consumed by the Work.

```bash
# Use -s or COHUB_SPACE_ID to target the Space.
cohub -s <space-id> spaces commerce setup

cohub -s <space-id> spaces commerce benefits create \
  --benefit-key space_pro \
  --name "Space Pro"

cohub -s <space-id> spaces commerce products create \
  --product-key pro_unlock \
  --name "Pro Unlock" \
  --amount-usd 9.99 \
  --visibility public \
  --status active

cohub -s <space-id> spaces commerce bind \
  --product-key pro_unlock \
  --benefit-key space_pro
```

Useful inspection commands:

```bash
cohub -s <space-id> spaces commerce products list
cohub -s <space-id> spaces commerce benefits list
cohub -s <space-id> spaces commerce orders list --limit 10
```

## Debug a published Work

Use the Work commerce commands to test the same server-side flow without opening the demo UI.

```bash
cohub works commerce products resolve \
  --work-id <work-id> \
  --product-key pro_unlock

cohub works commerce entitlements check \
  --work-id <work-id> \
  --benefit-key space_pro

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
    const [{ products }, { entitlements }, checkoutState] = await Promise.all([
      cohub.work.commerce.resolveProducts({ productKeys: [PRODUCT_KEY] }),
      cohub.work.commerce.checkEntitlements({ benefitKeys: [BENEFIT_KEY] }),
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

## Notes

- Do not cache order state only inside the iframe.
- Treat `purchase()` as a user action that may redirect away immediately.
- Treat `getCheckoutState()` as a transient signal from the outer host.
- Treat `getOrder(orderId)` as the authoritative order-specific follow-up check.
- Keep Work copy simple and short.
- Keep Space setup explicit in scripts: use `-s <space-id>` or `COHUB_SPACE_ID`.
