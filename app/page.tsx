import { ExcelWorkspace } from "@/components/excel-workspace";
import { requireAdminPage } from "@/lib/server/require-admin";

export const instant = false;

export default async function Home() {
  await requireAdminPage();

  return (
    <ExcelWorkspace />
  );
}
