# Cohub Work Commerce Guide

Work commerce lets a published Work sell one-time products backed by Space-level billing data.

## Scope of this first version

- `business = space`
- products live in billing
- benefits live in billing
- product-benefit bindings live in billing
- orders live in billing
- the Work hardcodes product keys and benefit keys
- the outer host owns checkout confirmation and redirect

## Runtime flow

1. The Work calls `cohub.work.commerce.resolveProducts()`.
2. The Work calls `cohub.work.commerce.checkEntitlements()`.
3. The user clicks Buy.
4. The Work calls `cohub.work.commerce.purchase()`.
5. The outer host creates the order and redirects to checkout.
6. The provider returns to the Work public URL with `cohub_checkout` and, when available, `cohub_order`.
7. The Work calls `cohub.work.commerce.getCheckoutState()`.
8. If an `orderId` is available, the Work calls `cohub.work.commerce.getOrder(orderId)`.

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

const { products } = await cohub.work.commerce.resolveProducts({
  productKeys: ["pro_unlock"],
});

const { entitlements } = await cohub.work.commerce.checkEntitlements({
  benefitKeys: ["space_pro"],
});

const checkout = await cohub.work.commerce.purchase({
  productKey: "pro_unlock",
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
- create feature benefits
- attach benefits to products
- inspect recent Space orders

## Demo

See:

- `docs/work-capability-lab/commerce-demo.md`
