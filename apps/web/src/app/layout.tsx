import "./globals.css";
import "leaflet/dist/leaflet.css"; // global CSS from a node_module must be imported from a root layout
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import ClientShell from "@/app/shell";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "QSTEEL Logistics Platform",
  description: "AI-driven logistics management for rakes, yards, and routes.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-steel-dark text-gray-100">
        <Nav />
        <ToastProvider>
          <ClientShell>
            {children}
          </ClientShell>
        </ToastProvider>
      </body>
    </html>
  );
}
