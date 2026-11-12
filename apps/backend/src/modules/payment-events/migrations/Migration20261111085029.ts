import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261111085029 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_event" ("id" text not null, "provider" text not null, "event_id" text not null, "kind" text check ("kind" in ('webhook', 'reconciliation')) not null default 'webhook', "status" text check ("status" in ('processing', 'processed', 'failed')) not null default 'processing', "payment_id" text null, "action" text null, "payload" jsonb null, "error_message" text null, "processed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_event_deleted_at" ON "payment_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_event_provider_event_id" ON "payment_event" ("provider", "event_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_event_payment_id" ON "payment_event" ("payment_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_event" cascade;`);
  }

}
