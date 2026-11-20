import type { Metadata } from "next";
import SecurityPanel from "./security-panel";

export const metadata: Metadata = { title: "Account security" };

export default function SecurityPage() {
  return <SecurityPanel />;
}
