import { redirect } from "next/navigation";
import { getDefaultLocale } from "@/lib/locale";

export default function RootPage() {
  redirect(`/${getDefaultLocale()}`);
}
