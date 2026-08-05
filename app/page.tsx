import type { Metadata } from "next";
import { QuoteTool } from "./QuoteTool";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "E3 Quoter · Quote Table",
  description: "Quote and gross margin approval tool",
};

export default function Home() {
  return <QuoteTool />;
}
