// local imports
import { getDashboardSnapshot } from "../core/services.js";
import { dashboardText } from "./dashboard.js";
import { parsePackageJsonContents } from "../core/utils.js";

/** The dashboard as plain text, for pipes, CI and `swale > today.txt`. */
export async function printPlainDashboard(): Promise<void> {
  const snapshot = await getDashboardSnapshot();
  console.log(dashboardText(snapshot, parsePackageJsonContents().version, { narrow: false }));
  console.log("");
}
