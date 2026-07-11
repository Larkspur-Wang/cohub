CREATE TABLE "v2"."referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"code" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"inviter_user_id" varchar(255) NOT NULL,
	"invitee_user_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone,
	"rewarded_at" timestamp with time zone,
	"inviter_rewarded_at" timestamp with time zone,
	"invitee_rewarded_at" timestamp with time zone,
	"inviter_reward_amount_usd" numeric(12, 8) NOT NULL,
	"invitee_reward_amount_usd" numeric(12, 8) NOT NULL,
	"reward_error" text,
	"reward_attempted_at" timestamp with time zone,
	"reward_lease_token" varchar(64),
	"reward_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_referral_codes_code" ON "v2"."referral_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_referral_codes_active_user" ON "v2"."referral_codes" USING btree ("user_id") WHERE "v2"."referral_codes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "v2_idx_referral_codes_user" ON "v2"."referral_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_referrals_invitee" ON "v2"."referrals" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "v2_idx_referrals_inviter" ON "v2"."referrals" USING btree ("inviter_user_id");--> statement-breakpoint
CREATE INDEX "v2_idx_referrals_code" ON "v2"."referrals" USING btree ("referral_code_id");--> statement-breakpoint
CREATE INDEX "v2_idx_referrals_qualified_retry" ON "v2"."referrals" USING btree ("reward_attempted_at") WHERE "v2"."referrals"."status" = 'qualified';
