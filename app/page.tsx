import type { Metadata } from "next";
import { QuoteTool } from "./QuoteTool";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "E3 Quoter · Quote Table",
  description: "Quote and gross margin approval tool",
};

export default async function Home() {
  await requireChatGPTUser("/");
  return <QuoteTool />;
}
