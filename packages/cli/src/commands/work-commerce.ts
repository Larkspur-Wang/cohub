import type { BillingCatalogProduct, WorkCommerceEntitlementCheckItem, WorkCommerceOrder } from "@neta-art/cohub";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { error, handleHttp, json as outJson, jsonRequested, ok, table } from "../output.js";

type JsonOption = { json?: boolean };

type ProductKeysOptions = JsonOption & {
  workId?: string;
  productKey?: string[];
};

type BenefitKeysOptions = JsonOption & {
  workId?: string;
  benefitKey?: string[];
};

type PurchaseOptions = JsonOption & {
  workId?: string;
  productKey?: string;
};

type OrderGetOptions = JsonOption & {
  workId?: string;
  orderId?: string;
};

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function requireText(value: string | undefined, label: string, flag: string): string {
  const text = value?.trim();
  if (text) return text;
  return error(`Missing ${label}`, `Pass ${flag}.`);
}

function requireList(values: string[] | undefined, label: string, flag: string): string[] {
  const items = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (items.length > 0) return items;
  return error(`Missing ${label}`, `Pass ${flag}.`);
}

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMinorUsd(amountMinor: number): string {
  return formatUsd(amountMinor / 100);
}

function printProducts(products: BillingCatalogProduct[]): void {
  table(products.map((product) => ({
    key: product.key,
    name: product.name,
    status: product.status,
    visibility: product.visibility,
    price: formatUsd(product.pricing.amountUsd),
  })), [
    { key: "key", label: "Key" },
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "visibility", label: "Visibility" },
    { key: "price", label: "Price" },
  ]);
}

function printEntitlements(entitlements: WorkCommerceEntitlementCheckItem[]): void {
  table(entitlements.map((item) => ({
    benefitKey: item.benefitKey,
    enabled: item.enabled ? "yes" : "no",
    reason: item.reason,
    metadata: item.metadata ? JSON.stringify(item.metadata) : "",
  })), [
    { key: "benefitKey", label: "Benefit" },
    { key: "enabled", label: "Enabled" },
    { key: "reason", label: "Reason" },
    { key: "metadata", label: "Metadata" },
  ]);
}

function printOrder(order: WorkCommerceOrder): void {
  table([{
    id: order.id,
    product: order.productKeySnapshot,
    status: order.status,
    amount: formatMinorUsd(order.amountSnapshot),
    paid: formatMinorUsd(order.paidAmountSnapshot),
    created: order.createdAt,
    paidAt: order.paidAt ?? "",
  }], [
    { key: "id", label: "ID" },
    { key: "product", label: "Product" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount" },
    { key: "paid", label: "Paid" },
    { key: "created", label: "Created" },
    { key: "paidAt", label: "Paid At" },
  ]);
}

export function registerWorkCommerce(worksCmd: Command): void {
  const commerceCmd = worksCmd
    .command("commerce")
    .description("Debug work commerce")
    .addHelpText("after", `
Examples:
  cohub works commerce products resolve --work-id <work-id> --product-key pro_pack
  cohub works commerce entitlements check --work-id <work-id> --benefit-key premium_export
`);

  const productsCmd = commerceCmd
    .command("products")
    .description("Debug commerce products");

  productsCmd
    .command("resolve")
    .description("Resolve public products for a work")
    .option("--work-id <id>", "Work ID")
    .option("--product-key <key>", "Product key", collectOption)
    .option("--json", "Output as JSON")
    .action(async (opts: ProductKeysOptions) => {
      const workId = requireText(opts.workId, "work ID", "--work-id <id>");
      const productKeys = requireList(opts.productKey, "product key", "--product-key <key>");
      const client = createClient();
      try {
        const result = await client.workCommerce.resolveProducts(workId, { productKeys });
        if (jsonRequested(opts)) return outJson(result);
        printProducts(result.products);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  const entitlementsCmd = commerceCmd
    .command("entitlements")
    .description("Debug commerce entitlements");

  entitlementsCmd
    .command("check")
    .description("Check viewer entitlements for a work")
    .option("--work-id <id>", "Work ID")
    .option("--benefit-key <key>", "Benefit key", collectOption)
    .option("--json", "Output as JSON")
    .action(async (opts: BenefitKeysOptions) => {
      const workId = requireText(opts.workId, "work ID", "--work-id <id>");
      const benefitKeys = requireList(opts.benefitKey, "benefit key", "--benefit-key <key>");
      const client = createClient();
      try {
        const result = await client.workCommerce.checkEntitlements(workId, { benefitKeys });
        if (jsonRequested(opts)) return outJson(result);
        printEntitlements(result.entitlements);
        console.log(`\nChecked at: ${result.checkedAt}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  commerceCmd
    .command("purchase")
    .description("Create a work purchase checkout")
    .option("--work-id <id>", "Work ID")
    .option("--product-key <key>", "Product key")
    .option("--json", "Output as JSON")
    .action(async (opts: PurchaseOptions) => {
      const workId = requireText(opts.workId, "work ID", "--work-id <id>");
      const productKey = requireText(opts.productKey, "product key", "--product-key <key>");
      const client = createClient();
      try {
        const result = await client.workCommerce.purchase(workId, { productKey });
        if (jsonRequested(opts)) return outJson(result);
        ok(`Checkout created: ${result.checkout.orderId}`);
        table([{
          orderId: result.checkout.orderId,
          productKey: result.checkout.productKey,
          usable: result.checkout.checkoutUsable ? "yes" : "no",
          status: result.checkout.status ?? "",
          checkoutUrl: result.checkout.checkoutUrl ?? "",
          message: result.checkout.message ?? "",
        }], [
          { key: "orderId", label: "Order" },
          { key: "productKey", label: "Product" },
          { key: "usable", label: "Usable" },
          { key: "status", label: "Status" },
          { key: "checkoutUrl", label: "Checkout URL" },
          { key: "message", label: "Message" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  const ordersCmd = commerceCmd
    .command("orders")
    .description("Debug commerce orders");

  ordersCmd
    .command("get")
    .description("Show a work commerce order")
    .option("--work-id <id>", "Work ID")
    .option("--order-id <id>", "Order ID")
    .option("--json", "Output as JSON")
    .action(async (opts: OrderGetOptions) => {
      const workId = requireText(opts.workId, "work ID", "--work-id <id>");
      const orderId = requireText(opts.orderId, "order ID", "--order-id <id>");
      const client = createClient();
      try {
        const result = await client.workCommerce.getOrder(workId, orderId);
        if (jsonRequested(opts)) return outJson(result);
        printOrder(result.order);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
