---
"@neta-art/cohub": minor
---

Refactor billing API: replace `getUsageRecords` / `getOverages` with unified `getBalanceActivities`, replace `purchaseAddon` / `subscribePlan` with `createOrder` / `createSubscription`, add `createRedemption`, remove `getOrders` / `cancelOrderCheckout`, and update `cancelSubscriptionCheckout` / `cancelSubscriptionAutoRenew` method signatures. Remove related legacy types.
