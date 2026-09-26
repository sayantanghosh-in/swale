// library imports
import chalk from "chalk";
// local imports
import type { GithubRepositoryDetails, LeetcodeProfileDetails } from "./models.js";
import { COLORS } from "./constants.js";

export function formatLastRepositories(repos: GithubRepositoryDetails["res"]): string {
  let res = "";
  if (!Array.isArray(repos) || !repos.length) {
    res = "No repositories found...";
  } else {
    res += chalk.hex(COLORS.ORANGE).bold`Last modified repos:`;
    repos.forEach((r) => {
      res += `
👉 ${chalk.yellow(r?.name)} ⏰ ${chalk.underlineCurly.gray(new Date(r?.updated_at).toDateString())}
🔗 ${chalk.cyanBright(r?.html_url)}
💬 ${chalk.italic.blueBright(r?.description)}
`;
    });
  }
  return res;
}

export function formatLeetcodeContributions(
  data: LeetcodeProfileDetails,
  username: string,
): string {
  let res = "";
  res += chalk
    .hex(COLORS.ORANGE)
    .bold(`Leetcode (${chalk.cyan.bold.underlineDouble(username)}):\n`);
  res += `🚀 ${chalk.white.underlineDashed("Ranking:")} ${chalk.blue.green.bold(data?.ranking)}\n`;
  res += `⭐️ ${chalk.white.underlineDashed("Solved:")} ${chalk.blue.yellow.bold(" " + data?.totalSolved + " ")}/${chalk.blueBright(data?.totalQuestions)}\n`;
  res += `⚡️ ${chalk.hex(COLORS.ORANGE).bold("All:")} ${chalk.cyan.underline(data?.totalSubmissions[0]?.count)} ${chalk.green.bold("Easy:")} ${chalk.cyan.underline(data?.totalSubmissions[1]?.count)} ${chalk.yellow.bold("Med:")} ${chalk.cyan.underline(data?.totalSubmissions[2]?.count)}  ${chalk.red.bold("Hard:")} ${chalk.cyan.underline(data?.totalSubmissions[3]?.count)}`;
  if (!(Array.isArray(data?.recentSubmissions) && data?.recentSubmissions?.length)) {
    return res;
  }
  res += chalk.hex(COLORS.ORANGE).bold("\n\nLast Solved:");
  for (let i = 0; i < 5; i++) {
    const sub = data?.recentSubmissions[i];
    res += `\n👉 ${chalk.yellow(sub?.title)} ⏰ ${chalk.underlineCurly.gray(new Date(Number(sub?.timestamp) * 1000).toDateString())}\n`;
    res += `${sub?.statusDisplay === "Accepted" ? "✅" : sub?.statusDisplay?.toLowerCase()?.startsWith("wrong") ? "❌" : "🤔"} ${sub?.statusDisplay?.toLowerCase() === "accepted" ? chalk.green("Accepted") : sub?.statusDisplay?.toLowerCase()?.startsWith("wrong") ? chalk.red(sub?.statusDisplay) : chalk.yellow(sub?.statusDisplay)}\n`;
    res += `🔗 ${chalk.cyanBright("https://leetcode.com/problems/" + sub?.slug)}\n`;
  }
  return res;
}
