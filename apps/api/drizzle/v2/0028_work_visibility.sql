ALTER TABLE "v2"."works" ADD COLUMN "visibility" varchar(20) DEFAULT 'public' NOT NULL;

CREATE INDEX "v2_idx_works_visibility" ON "v2"."works" USING btree ("visibility");

ALTER TABLE "v2"."works" ADD CONSTRAINT "v2_chk_works_visibility" CHECK ("visibility" in ('public', 'space'));
