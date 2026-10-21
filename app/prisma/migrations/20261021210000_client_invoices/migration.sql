-- AlterTable
ALTER TABLE "clients" ADD COLUMN "qbo_customer_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "client_invoices" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "qbo_invoice_id" VARCHAR(64) NOT NULL,
    "doc_number" VARCHAR(64),
    "txn_date" DATE NOT NULL,
    "due_date" DATE,
    "total" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "pay_link" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_qbo_invoice_id_key" ON "client_invoices"("qbo_invoice_id");

-- CreateIndex
CREATE INDEX "client_invoices_client_id_status_idx" ON "client_invoices"("client_id", "status");

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
