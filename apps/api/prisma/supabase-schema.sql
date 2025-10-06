-- Supabase Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types
CREATE TYPE "Role" AS ENUM ('admin', 'manager', 'supervisor', 'customer', 'rake_planner', 'yard');
CREATE TYPE "RakeStatus" AS ENUM ('PENDING', 'DISPATCHED');
CREATE TYPE "Priority" AS ENUM ('Normal', 'Urgent');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPROVED', 'LOADING', 'EN_ROUTE', 'DELIVERED', 'REJECTED');
CREATE TYPE "LoginType" AS ENUM ('password', 'otp');
CREATE TYPE "LoadingStatus" AS ENUM ('UNDER_LOADING', 'READY', 'DISPATCHED');
CREATE TYPE "AllocationStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');

-- Create tables
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Plant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Yard" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "plantId" INTEGER NOT NULL,

    CONSTRAINT "Yard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rake" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "rfid" TEXT,
    "yardId" INTEGER,
    "status" "RakeStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Rake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Wagon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "rakeId" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'general',
    "capT" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "Wagon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Dispatch" (
    "id" SERIAL NOT NULL,
    "rakeId" INTEGER NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "tonnage" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Station" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Route" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromId" INTEGER,
    "toId" INTEGER,
    "plantId" INTEGER,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteStation" (
    "id" SERIAL NOT NULL,
    "routeId" INTEGER NOT NULL,
    "stationId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "RouteStation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
    "customerId" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gstin" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("customerId")
);

CREATE TABLE "Order" (
    "orderId" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "customerId" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "quantityTons" INTEGER NOT NULL,
    "sourcePlant" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'Normal',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimateCost" INTEGER,
    "eta" TIMESTAMP(3),
    "rakeId" TEXT,
    "history" JSONB,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("orderId")
);

CREATE TABLE "AuthLog" (
    "id" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "loginType" "LoginType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "YardActivity" (
    "id" SERIAL NOT NULL,
    "rakeId" TEXT NOT NULL,
    "orderId" TEXT,
    "loadingStatus" "LoadingStatus" NOT NULL DEFAULT 'UNDER_LOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YardActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'draft',
    "payload" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllocationAudit" (
    "id" SERIAL NOT NULL,
    "allocId" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "page" TEXT,
    "action" TEXT,
    "meta" JSONB,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- Create unique constraints
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Plant_name_key" ON "Plant"("name");
CREATE UNIQUE INDEX "Rake_code_key" ON "Rake"("code");
CREATE UNIQUE INDEX "Rake_rfid_key" ON "Rake"("rfid");
CREATE UNIQUE INDEX "Wagon_code_key" ON "Wagon"("code");
CREATE UNIQUE INDEX "Dispatch_rakeId_key" ON "Dispatch"("rakeId");
CREATE UNIQUE INDEX "Station_code_key" ON "Station"("code");
CREATE UNIQUE INDEX "Route_key_key" ON "Route"("key");
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- Create composite unique constraints
CREATE UNIQUE INDEX "RouteStation_routeId_seq_key" ON "RouteStation"("routeId", "seq");

-- Create indexes
CREATE INDEX "RouteStation_routeId_seq_idx" ON "RouteStation"("routeId", "seq");
CREATE INDEX "AllocationAudit_allocId_ts_idx" ON "AllocationAudit"("allocId", "ts");
CREATE INDEX "Event_ts_idx" ON "Event"("ts");
CREATE INDEX "Event_role_ts_idx" ON "Event"("role", "ts");

-- Add foreign key constraints
ALTER TABLE "Yard" ADD CONSTRAINT "Yard_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rake" ADD CONSTRAINT "Rake_yardId_fkey" FOREIGN KEY ("yardId") REFERENCES "Yard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Wagon" ADD CONSTRAINT "Wagon_rakeId_fkey" FOREIGN KEY ("rakeId") REFERENCES "Rake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_rakeId_fkey" FOREIGN KEY ("rakeId") REFERENCES "Rake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteStation" ADD CONSTRAINT "RouteStation_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteStation" ADD CONSTRAINT "RouteStation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("customerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthLog" ADD CONSTRAINT "AuthLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("customerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AllocationAudit" ADD CONSTRAINT "AllocationAudit_allocId_fkey" FOREIGN KEY ("allocId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable Row Level Security (RLS) for all tables (recommended for Supabase)
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Yard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Rake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Wagon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Dispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Station" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Route" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RouteStation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "YardActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Allocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AllocationAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;

-- Create basic RLS policies (you can customize these based on your needs)
-- Example policy for customers to only access their own data
CREATE POLICY "Customers can view own data" ON "Customer"
    FOR SELECT USING (auth.uid()::text = "customerId");

CREATE POLICY "Customers can update own data" ON "Customer"
    FOR UPDATE USING (auth.uid()::text = "customerId");

-- Example policy for orders
CREATE POLICY "Customers can view own orders" ON "Order"
    FOR SELECT USING (auth.uid()::text = "customerId");

CREATE POLICY "Customers can create orders" ON "Order"
    FOR INSERT WITH CHECK (auth.uid()::text = "customerId");

-- Add more policies as needed for your specific use case