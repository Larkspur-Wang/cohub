CREATE TABLE "v2"."space_commerce_businesses" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"billing_business_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_uq_space_commerce_businesses_business_key" ON "v2"."space_commerce_businesses" USING btree ("billing_business_key");