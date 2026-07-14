export type FeatureBenefitConfig = {
  metadata: Record<string, string | number | boolean>;
};

export type CreditsBenefitConfig = {
  token_type: string;
  amount: number;
  priority?: number;
  scope: "global" | "business";
  grant_kind: "plan_period" | "purchased" | "manual" | "promo";
  grant_period?: "month" | "day";
  expires_in_days?: number;
};

export type FeatureBenefit = {
  id: string;
  business_id: string;
  key: string;
  type: "feature";
  name: string;
  description: string | null;
  status: string;
  config: FeatureBenefitConfig;
  config_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type CreditsBenefit = {
  id: string;
  business_id: string;
  key: string;
  type: "credits";
  name: string;
  description: string | null;
  status: string;
  config: CreditsBenefitConfig;
  config_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type Benefit = FeatureBenefit | CreditsBenefit;

export type Product = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  billing_type?: string;
  billing_period?: string | null;
  billing_interval_count?: number | null;
  currency?: string;
  amount?: number;
  unit_amount?: number;
  compare_at_unit_amount?: number | null;
  meta?: Record<string, unknown> | null;
  is_default_plan?: boolean;
  [key: string]: unknown;
};

export type CommerceOrder = {
  id: string;
  product_key_snapshot: string;
  product_name_snapshot: string;
  status: string;
  amount_snapshot: number;
  paid_amount_snapshot: number;
  created_at: string;
  paid_at: string | null;
  external_user_id?: string | null;
  customer?: { external_user_id?: string | null } | null;
  [key: string]: unknown;
};

export type ProductBenefit = {
  id: string | null;
  product_key?: string;
  benefit_key: string;
  created_at?: string | null;
  [key: string]: unknown;
};

export type PurchasedCreditsBenefitConfig = CreditsBenefitConfig & {
  grant_kind: "purchased";
};
