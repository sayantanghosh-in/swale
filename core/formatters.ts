// library imports
import chalk from "chalk";
// local imports
import type { GithubRepositoryDetails } from "./models.js";
import { COLORS } from "./constants.js";

export function formatLastRepositories(repos: GithubRepositoryDetails["res"]): string {
  let res = "";
  if (!Array.isArray(repos) || !repos.length) {
    res = "No repositories found...";
  } else {
    res += chalk.hex(COLORS.ORANGE).bold`Last modified repos:`;
    repos.forEach((r) => {
      res += `
👉 ${chalk.yellow(r?.name)} ⏰ ${chalk.underlineCurly.gray(new Date(r?.updated_at).toLocaleDateString())}
🔗 ${chalk.cyanBright(r?.html_url)}
💬 ${chalk.italic.blueBright(r?.description)}
`;
    });
  }
  return res;
}
