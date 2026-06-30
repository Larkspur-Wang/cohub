# Cohub Work Commerce Guide

Work commerce lets a published Work sell one-time products backed by Space-level billing data. Products can carry **feature benefits** (access gates) and **credit benefits** (consumable credits).

## Scope

- `business = space`
- products, benefits, bindings, and orders live in billing
- the Work hardcodes product keys and benefit keys
- the outer host owns checkout confirmation and redirect
- credits use a virtual `cohub_credit` token at business scope — creators never reason about token types

## Benefit types

| Type | What it does | Creator config |
|---|---|---|
| `feature` | Gates access to a capability via metadata (`enabled`, numeric limits) | Name, description, metadata fields |
| `credits` | Grants a fixed amount of consumable credits when the bound product is purchased | Name, description, amount, optional expiry in days |

Credit benefits are always business-scoped and one-time purchased. When an order is paid, billing automatically grants the credits to the customer — no fulfillment code is needed.

## Runtime flow

1. The Work calls `cohub.work.commerce.resolveProducts()`.
2. The Work calls `cohub.work.commerce.getEntitlements()` — returns feature entitlements **and** credit balance in one call.
3. The user clicks Buy.
4. The Work calls `cohub.work.commerce.purchase()`.
5. The outer host creates the order and redirects to checkout.
6. The provider returns to the Work public URL with `cohub_checkout` and, when available, `cohub_order`.
7. The Work calls `cohub.work.commerce.getCheckoutState()`.
8. If an `orderId` is available, the Work calls `cohub.work.commerce.getOrder(orderId)`.

## Consuming credits

When a user performs a metered action inside the Work, credits are consumed through `cohub.work.commerce.consumeCredits()`:

```ts
const result = await cohub.work.commerce.consumeCredits({
  amount: 10,
  operationId: crypto.randomUUID(),
  reason: "Export high-res image",
});
// result.status: "consumed" | "insufficient" | "disabled"
// result.remaining: current credit balance
```

- `operationId` is an idempotency key — reuse it to safely retry without double-charging.
- When `status` is `"insufficient"`, the user has no remaining credits — prompt them to purchase.
- The CLI can also consume credits on behalf of a viewer (self by default, or via prompt-driven flows):

```bash
cohub works commerce credits consume --work-id <work-id> --amount 100
```

## Why order state is handled this way

`purchase()` returns an order id before redirect.

The outer host is the right place to keep the pending purchase state because it controls:

- sign-in
- top-level navigation
- redirect return
- iframe bridge

The iframe should not be the primary place that owns pending checkout state.

Best practice:

- let the outer host cache the most recent pending order id for the current work
- let the Work ask the host for checkout state
- let the Work query the order again by id when it needs authoritative follow-up state

## Recommended Work-side API usage

```ts
const cohub = createCohubClient();
const PRODUCT_KEY = "pro_unlock";
const BENEFIT_KEY = "space_pro";

const { products } = await cohub.work.commerce.resolveProducts({
  productKeys: [PRODUCT_KEY],
});

const { entitlements, credits } = await cohub.work.commerce.getEntitlements();
// entitlements: [{ benefitKey, enabled, metadata }]
// credits: { available, net }

const checkout = await cohub.work.commerce.purchase({
  productKey: PRODUCT_KEY,
});

const checkoutState = await cohub.work.commerce.getCheckoutState();
if (checkoutState.orderId) {
  const { order } = await cohub.work.commerce.getOrder(checkoutState.orderId);
}
```

## Space management

Space owners manage commerce at the Space level.

Current supported operations:

- create products
- create feature benefits and credit benefits
- attach benefits to products
- inspect recent Space orders

## Demo

See:

- `docs/work-capability-lab/commerce-demo.md`
