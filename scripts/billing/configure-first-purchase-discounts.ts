import process from "node:process";

const FIRST_PURCHASE_MARKER = "cohub_first_purchase_default_v1";
const FIRST_PURCHASE_PRODUCT_KEY = "cohub_first_purchase_product_key";
const apply = process.argv.includes("--apply");

const baseUrl = process.env.TALESOFAI_BILLING_BASE_URL?.replace(/\/+$/, "");
const businessKey = process.env.TALESOFAI_BILLING_BUSINESS_KEY?.trim();
const adminApiKey = process.env.TALESOFAI_BILLING_ADMIN_API_KEY?.trim();

if (!baseUrl || !businessKey || !adminApiKey) {
  throw new Error(
    "TALESOFAI_BILLING_BASE_URL, TALESOFAI_BILLING_BUSINESS_KEY, and TALESOFAI_BILLING_ADMIN_API_KEY are required",
  );
}

type Product = {
  key: string;
  name: string;
  status: string;
  visibility: string;
  billing_type: "recurring" | "one_time" | string;
  amount: number;
  meta?: Record<string, unknown>;
};

type Discount = {
  id: string;
  name: string;
  status: string;
  version: number;
  created_at: string;
  code_preview: string | null;
  effect: { type: string; percentage_bps?: number };
  duration: { type: string };
  max_redemptions_per_customer: number | null;
  metadata: Record<string, unknown>;
};

type DiscountProduct = {
  product_key?: string;
  key?: string;
  status?: string;
};

type ListResponse<T> = {
  items: T[];
  pagination: { has_more: boolean };
};

async function request<T>(
  path: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
  } = {},
): Promise<T> {
  const url = new URL(`${baseUrl}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${adminApiKey}`,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Billing ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await request<ListResponse<T>>(path, {
      query: {
        business_key: businessKey,
        include_count: false,
        page,
        limit: 100,
      },
    });
    items.push(...response.items);
    if (!response.pagination.has_more) return items;
  }
  throw new Error(`Billing ${path} exceeded 2,000 records`);
}

async function listDiscountProducts(
  discountId: string,
): Promise<DiscountProduct[]> {
  const response = await request<{ items: DiscountProduct[] }>(
    `/discounts/${encodeURIComponent(discountId)}/products`,
    { query: { business_key: businessKey } },
  );
  return response.items;
}

function discountIdentity(discount: Discount): string | null {
  const kind = discount.metadata[FIRST_PURCHASE_MARKER];
  const productKey = discount.metadata[FIRST_PURCHASE_PRODUCT_KEY];
  return kind === "subscription"
    ? "subscription"
    : kind === "addon" && typeof productKey === "string"
      ? `addon:${productKey}`
      : null;
}

async function main() {
  const [products, discounts] = await Promise.all([
    listAll<Product>("/products"),
    listAll<Discount>("/discounts"),
  ]);

  const paidProducts = products.filter(
    (product) =>
      product.status === "active" &&
      product.visibility === "public" &&
      product.amount > 0 &&
      product.meta?.appName === "cohub",
  );
  const plans = paidProducts.filter(
    (product) => product.billing_type === "recurring",
  );
  const addons = paidProducts.filter(
    (product) => product.billing_type === "one_time",
  );

  if (plans.length === 0)
    throw new Error("No eligible Cohub subscription products found");

  const definitions = [
    {
      name: "Cohub first subscription 50% off",
      productKeys: plans.map((product) => product.key),
      metadata: { [FIRST_PURCHASE_MARKER]: "subscription" },
    },
    ...addons.map((product) => ({
      name: `Cohub ${product.name} first purchase 50% off`,
      productKeys: [product.key],
      metadata: {
        [FIRST_PURCHASE_MARKER]: "addon",
        [FIRST_PURCHASE_PRODUCT_KEY]: product.key,
      },
    })),
  ];

  const existingByIdentity = new Map<string, Discount>();
  for (const discount of discounts) {
    if (discount.status === "archived") continue;
    const identity = discountIdentity(discount);
    if (!identity) continue;
    const current = existingByIdentity.get(identity);
    if (!current || discount.created_at > current.created_at) {
      existingByIdentity.set(identity, discount);
    }
  }

  async function assertExistingDiscountMatches(input: {
    identity: string;
    discount: Discount;
    productKeys: string[];
  }) {
    const errors: string[] = [];
    if (input.discount.status !== "active")
      errors.push(`status=${input.discount.status}`);
    if (input.discount.code_preview !== null)
      errors.push("has a promotion code");
    if (
      input.discount.effect.type !== "percentage" ||
      input.discount.effect.percentage_bps !== 5_000
    ) {
      errors.push("effect is not 50% off");
    }
    if (input.discount.duration.type !== "once")
      errors.push("duration is not once");
    if (input.discount.max_redemptions_per_customer !== 1) {
      errors.push("max_redemptions_per_customer is not 1");
    }

    const bindings = await listDiscountProducts(input.discount.id);
    const actualProductKeys = bindings
      .filter(
        (binding) =>
          binding.status === undefined || binding.status === "active",
      )
      .map((binding) => binding.product_key ?? binding.key)
      .filter((key): key is string => typeof key === "string")
      .sort();
    const expectedProductKeys = [...input.productKeys].sort();
    if (
      JSON.stringify(actualProductKeys) !== JSON.stringify(expectedProductKeys)
    ) {
      errors.push(
        `product scope is ${JSON.stringify(actualProductKeys)}, expected ${JSON.stringify(expectedProductKeys)}`,
      );
    }
    if (errors.length > 0) {
      throw new Error(
        `Existing ${input.identity} Discount ${input.discount.id} is invalid: ${errors.join("; ")}`,
      );
    }
  }

  await Promise.all(
    definitions.map(async (definition) => {
      const kind = definition.metadata[FIRST_PURCHASE_MARKER];
      const identity =
        kind === "subscription"
          ? "subscription"
          : `addon:${String(definition.metadata[FIRST_PURCHASE_PRODUCT_KEY])}`;
      const existing = existingByIdentity.get(identity);
      if (existing) {
        await assertExistingDiscountMatches({
          identity,
          discount: existing,
          productKeys: definition.productKeys,
        });
      }
    }),
  );

  const plan = definitions.map((definition) => {
    const kind = definition.metadata[FIRST_PURCHASE_MARKER];
    const identity =
      kind === "subscription"
        ? "subscription"
        : `addon:${String(definition.metadata[FIRST_PURCHASE_PRODUCT_KEY])}`;
    const existing = existingByIdentity.get(identity);
    return {
      identity,
      action: existing ? "keep" : "create",
      existingDiscountId: existing?.id ?? null,
      name: definition.name,
      productKeys: definition.productKeys,
      metadata: definition.metadata,
    };
  });

  console.log(JSON.stringify({ apply, businessKey, plan }, null, 2));
  if (!apply) {
    console.log(
      "Dry run only. Re-run with --apply after reviewing the product list.",
    );
    return;
  }

  for (const definition of definitions) {
    const kind = definition.metadata[FIRST_PURCHASE_MARKER];
    const identity =
      kind === "subscription"
        ? "subscription"
        : `addon:${String(definition.metadata[FIRST_PURCHASE_PRODUCT_KEY])}`;
    if (existingByIdentity.has(identity)) {
      console.log(
        `Keeping existing ${identity} Discount ${existingByIdentity.get(identity)?.id}`,
      );
      continue;
    }
    const created = await request<{ discount: Discount }>("/discounts", {
      method: "POST",
      body: {
        business_key: businessKey,
        name: definition.name,
        code: null,
        effect: { type: "percentage", percentage_bps: 5_000 },
        duration: { type: "once" },
        product_scope: {
          type: "specific_products",
          product_keys: definition.productKeys,
        },
        max_redemptions: null,
        max_redemptions_per_customer: 1,
        metadata: definition.metadata,
      },
    });
    const matchingDiscounts = (await listAll<Discount>("/discounts")).filter(
      (discount) =>
        discount.status !== "archived" &&
        discountIdentity(discount) === identity,
    );
    if (
      matchingDiscounts.length !== 1 ||
      matchingDiscounts[0]?.id !== created.discount.id
    ) {
      await request<{ discount: Discount }>(
        `/discounts/${encodeURIComponent(created.discount.id)}/archive`,
        {
          method: "POST",
          body: {
            business_key: businessKey,
            expected_version: created.discount.version,
            reason_code: "concurrent_configuration",
            reason: "Superseded by a concurrent first-purchase configuration",
          },
        },
      );
      const existing = matchingDiscounts.find(
        (discount) =>
          discount.id !== created.discount.id && discount.status === "active",
      );
      if (existing) {
        await assertExistingDiscountMatches({
          identity,
          discount: existing,
          productKeys: definition.productKeys,
        });
        existingByIdentity.set(identity, existing);
        console.log(
          `Archived concurrent ${identity} draft and kept active Discount ${existing.id}`,
        );
        continue;
      }
      throw new Error(
        `Concurrent configuration detected for ${identity}; the new draft was archived and no Discount was activated`,
      );
    }
    const activated = await request<{ discount: Discount }>(
      `/discounts/${encodeURIComponent(created.discount.id)}/activate`,
      {
        method: "POST",
        body: {
          business_key: businessKey,
          expected_version: created.discount.version,
        },
      },
    );
    console.log(`Activated ${identity} Discount ${activated.discount.id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
