import type { Metadata } from "next";
import { QuoteTool } from "./QuoteTool";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QuoteFlow · Gross Margin",
  description: "Fox ESS CQ7 quoting and gross margin approval tool",
};

export default function Home() {
  return <QuoteTool />;
}
