import type { Metadata } from "next";
import { QuoteTool } from "./QuoteTool";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QuoteFlow · Gross Margin",
  description: "Fox ESS CQ7 报价与毛利审批工具",
};

export default function Home() {
  return <QuoteTool />;
}
