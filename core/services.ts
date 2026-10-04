// library imports
import chalk from "chalk";
import type { ModelMessage } from "ai";
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { input, select } from "@inquirer/prompts";
// node imports
import readline from "readline/promises";
// local imports
import {
  LEETCODE_GRAPHQL_URL,
  LEETCODE_PROFILE_URL,
  SWALE_GITHUB_ISSES_LINK,
} from "./constants.js";
import { createUserObject, insertUser, listAllUsers, loginUser } from "./users/main.js";
import {
  askForLLMDetails,
  createOrUpdateConfig,
  getGithubAuth,
  getLlmDetails,
  resolveModel,
} from "./utils.js";
import type { LeetcodeBasicDetailsMeta, LeetcodeProfileDetails } from "./models.js";
import { getGithubUserProfileDetails, getOctokit } from "./octokit.js";
import {
  createConnectionsObject,
  insertConnection,
  validateGithubLoginWithExistingConnection,
} from "./connections/main.js";
import { resolveAgentContext, runAgent } from "./agent.js";
import { CALENDAR_WEEKS, COLORS } from "./constants.js";
import { calendarStats, fillCalendarWindow, leetcodeCalendarToDays, toDateKey } from "./utils.js";
import { getContributionCalendar } from "./octokit.js";
import { countTodosByStatus, listTodos } from "./todos/main.js";
import { countNotes } from "./notes/main.js";
import { summariseExpenses } from "./expenses/main.js";
import { fetchLoginByProvider } from "./connections/main.js";
import { getActiveUser } from "./users/main.js";
import type { DashboardSnapshot } from "./models.js";

async function queryLeetCode<T = any>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LEETCODE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://leetcode.com",
      Origin: "https://leetcode.com",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data: T; errors?: unknown };

  if (json.errors) {
    throw new Error(`LeetCode GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

export async function getLeetcodeBasicDetails(username: string): Promise<LeetcodeBasicDetailsMeta> {
  const query = `
    query getBasicDetails($username: String!) {
      matchedUser(username: $username) {
        username
        profile {
          ranking
          realName
          userAvatar
        }
      }
      skillStats(username: $username) {
        fundamentalSkills { tagName }
        intermediateSkills { tagName }
        advancedSkills { tagName }
      }
    }
  `;

  const data = await queryLeetCode<{
    matchedUser: {
      username: string;
      profile: { ranking: number; realName: string; userAvatar: string };
    };
    skillStats: {
      fundamentalSkills: { tagName: string }[];
      intermediateSkills: { tagName: string }[];
      advancedSkills: { tagName: string }[];
    };
  }>(query, { username });

  const skills = [
    ...data.skillStats.fundamentalSkills,
    ...data.skillStats.intermediateSkills,
    ...data.skillStats.advancedSkills,
  ].map((s) => s.tagName);

  return {
    ranking: data.matchedUser.profile.ranking,
    skills,
    name: data.matchedUser.profile.realName || data.matchedUser.username,
    avatar: data.matchedUser.profile.userAvatar,
  };
}

export async function getLeetcodeProfileDetails(username: string): Promise<LeetcodeProfileDetails> {
  const currentYear = new Date().getFullYear();
  const query = `
    query getProfileDetails($username: String!, $year: Int!, $prevYear: Int!) {
      matchedUser(username: $username) {
        profile {
          ranking
        }
        submitStats: submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
            submissions
          }
          totalSubmissionNum {
            difficulty
            count
            submissions
          }
        }
        userCalendar(year: $year) {
          submissionCalendar
          activeYears
        }
        previousCalendar: userCalendar(year: $prevYear) {
          submissionCalendar
        }
      }
      allQuestionsCount {
        difficulty
        count
      }
      recentSubmissionList(username: $username, limit: 20) {
        title
        titleSlug
        timestamp
        statusDisplay
        lang
      }
    }
  `;

  const data = await queryLeetCode<{
    matchedUser: {
      profile: { ranking: number };
      submitStats: {
        acSubmissionNum: { difficulty: string; count: number; submissions: number }[];
        totalSubmissionNum: { difficulty: string; count: number; submissions: number }[];
      };
      userCalendar: { submissionCalendar: string; activeYears: number[] };
      previousCalendar: { submissionCalendar: string };
    };
    allQuestionsCount: { difficulty: string; count: number }[];
    recentSubmissionList: {
      title: string;
      titleSlug: string;
      timestamp: string;
      statusDisplay: string;
      lang: string;
    }[];
  }>(query, { username, year: currentYear, prevYear: currentYear - 1 });

  const totalSolved =
    data.matchedUser.submitStats.acSubmissionNum.find((d) => d.difficulty === "All")?.count ?? 0;

  const totalQuestions = data.allQuestionsCount.find((d) => d.difficulty === "All")?.count ?? 0;

  const totalSubmissions = data.matchedUser.submitStats.acSubmissionNum.map((d) => ({
    difficulty: d.difficulty as "All" | "Easy" | "Medium" | "Hard",
    count: d.count,
    submissions: d.submissions,
  }));

  // Two years merged: a rolling six-month window straddles New Year, and
  // userCalendar only ever returns the single year it is asked for.
  const submissionCalendar: { [key: string]: number } = {
    ...JSON.parse(data.matchedUser.previousCalendar?.submissionCalendar || "{}"),
    ...JSON.parse(data.matchedUser.userCalendar?.submissionCalendar || "{}"),
  };

  const recentSubmissions = data.recentSubmissionList.map((sub) => {
    return {
      title: sub?.title ?? "",
      slug: sub?.titleSlug ?? "",
      timestamp: sub?.timestamp ?? "",
      statusDisplay: sub?.statusDisplay ?? "",
      lang: sub?.lang ?? "",
    };
  });

  return {
    submissionCalendar,
    activeYears: data.matchedUser.userCalendar?.activeYears ?? [],
    ranking: data.matchedUser.profile.ranking,
    totalSolved,
    totalQuestions,
    totalSubmissions,
    recentSubmissions,
  };
}

const auth = createOAuthDeviceAuth({
  clientType: "oauth-app",
  clientId: process.env.SWALE_GITHUB_CLIENT_ID || "Ov23liJbUgcPQV2hYKX0",
  scopes: ["read:user", "user:email"],
  onVerification(verification) {
    console.log("Open %s", verification.verification_uri);
    console.log("Enter code: %s", verification.user_code);
  },
});

export async function onboarding() {
  // @TODO - refactor this function
  const existingAuth = getGithubAuth();
  if (!existingAuth?.token) {
    /*
     * Only sign-in needs a person at the keyboard. Guarding the whole function
     * would break `swale todo list | grep ...` and `swale gh sync > file`,
     * which are ordinary things to do with a CLI.
     */
    if (!process.stdin.isTTY) {
      console.error(
        "Swale needs an interactive terminal to connect your GitHub account.\nRun it once in a terminal first.",
      );
      process.exit(1);
    }
    // maybe the user is logging in after logging out
    // show all the users from which they can select
    // the one to make active
    const allUsers = listAllUsers();
    if (Array.isArray(allUsers) && allUsers.length) {
      // let the user choose
      let selectedUser = (await select({
        message: "Log in as?",
        choices: allUsers?.map((u) => {
          return {
            name: `${u?.name ?? "<No Name>"} ${(u?.email as string)?.trim()?.length ? "<" + u?.email + ">" : ""}`,
            value: u?.id,
          };
        }),
      })) as string;
      if (selectedUser) {
        const loginUserResponse = loginUser(selectedUser);
        if (loginUserResponse?.success) {
          // ask user to login to their github account as
          // the config was removed during logout
          const tokenAuthentication = await auth({
            type: "oauth",
          });
          // create the Octokit instance
          const oc = getOctokit({ auth: tokenAuthentication?.token });
          if (!oc) {
            console.error("ERROR_UNKNOWN_AUTH_ERROR");
            return;
          } else {
            // check if the logged in github user is the same one associated to the user in the database
            // compare the login column's value with the returned github login value
            const profileDetails = await getGithubUserProfileDetails();
            if (!profileDetails) {
              console.error("ERROR_FETCHING_GITHUB_PROFILE_INFORMATION");
              process.exit(1);
            }
            const { res } = profileDetails;
            const isUserValid = validateGithubLoginWithExistingConnection(
              selectedUser,
              res?.data?.login,
            );
            if (isUserValid) {
              // update the configuration file's github object
              createOrUpdateConfig({ github: tokenAuthentication });
            } else {
              console.error("ERROR_LOGGED_IN_GITHUB_USER_DOES_NOT_MATCH_WITH_SELECTED_USER");
            }
          }
          return;
        } else {
          console.error(loginUserResponse?.error);
          process.exit(1);
        }
      }
    }

    // ask user to login to their github account
    const tokenAuthentication = await auth({
      type: "oauth",
    });
    createOrUpdateConfig({ github: tokenAuthentication });

    // create / get the Octokit instance
    const oc = getOctokit({ auth: tokenAuthentication?.token });
    if (!oc) {
      console.error("ERROR_UNKNOWN_AUTH_ERROR");
      return;
    }
    const profileDetails = await getGithubUserProfileDetails();
    if (!profileDetails) {
      console.error("ERROR_FETCHING_GITHUB_PROFILE_INFORMATION");
      process.exit(1);
    }
    const { name, email, res } = profileDetails;
    const createUserObjectResult = createUserObject(name, email);

    if (createUserObjectResult.success && !!createUserObjectResult?.userObj?.id) {
      const insertUserResult = insertUser(createUserObjectResult.userObj);
      if (insertUserResult.success) {
        // create the connection record and link the user to that connection
        const login = res?.data?.login;
        const avatarUrl = res?.data?.avatar_url;
        const profileUrl = res?.data?.html_url;
        const linkedTo = createUserObjectResult?.userObj?.id;
        const createConnectionsObjectResult = createConnectionsObject(
          "github",
          login,
          name,
          avatarUrl,
          profileUrl,
          linkedTo,
          {},
        );
        if (
          createConnectionsObjectResult?.success &&
          createConnectionsObjectResult?.connectionsObj?.id
        ) {
          const insertConnectionsResult = insertConnection(
            createConnectionsObjectResult?.connectionsObj,
          );
          if (insertConnectionsResult?.success) {
            // ask the user for leetcode username
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            const username: string = await rl.question(
              "What is your leetcode username? It will be saved locally. [Press Enter to Skip]: ",
            );
            // ask for LLM details
            const llmStatus = await askForLLMDetails();
            if (!llmStatus) {
              console.warn(
                "Something went wrong while configuring the LLM. AI features will not work till its fixed...",
              );
            }
            rl.close();
            if (username?.trim()?.length) {
              const basicDetails: LeetcodeBasicDetailsMeta =
                await getLeetcodeBasicDetails(username);
              // save the leetcode username as a connection
              const leetcodeMeta = {
                ranking: basicDetails?.ranking || 0,
                skills: basicDetails?.skills || [],
              };
              const leetcodeConnectionObjectResult = createConnectionsObject(
                "leetcode",
                username,
                basicDetails?.name,
                basicDetails?.avatar,
                LEETCODE_PROFILE_URL + username,
                linkedTo,
                leetcodeMeta,
              );

              if (leetcodeConnectionObjectResult?.success) {
                const insertConnectionsResult = insertConnection(
                  leetcodeConnectionObjectResult?.connectionsObj,
                );
                if (!insertConnectionsResult?.success) {
                  console.error("ERROR_LEETCODE_CONNECTION - DB insert");
                  process.exit(1);
                } else {
                  console.log(
                    `${createUserObjectResult.userObj.name}, you have been added successfully...`,
                  );
                  return;
                }
              } else {
                console.error("ERROR_LEETCODE_CONNECTION - unknown");
                process.exit(1);
              }
            } else {
              console.log(
                `${createUserObjectResult.userObj.name}, you have been added successfully...`,
              );
              return;
            }
          }
        }
      } else {
        console.error(
          `We had a issue on our end. Please report the issue here: ${SWALE_GITHUB_ISSES_LINK}`,
        );
        process.exit(1);
      }
    } else {
      console.error(
        "The user could not be created... Please ensure all the entered fields are valid.",
      );
      process.exit(1);
    }
  } else {
    // user configuration already present, let them use swale...
    // create the Octokit instance
    const oc = getOctokit({ auth: existingAuth?.token });
    if (!oc) {
      console.error("ERROR_UNKNOWN_AUTH_ERROR");
      return;
    }
    return;
  }
}

/**
 * Models already pulled on the local Ollama host.
 *
 * Only meaningful for a local setup — a hosted provider has a catalogue, not
 * an installed list, so /model there can only confirm what is configured.
 */
export async function listLocalModels(baseUrl: string): Promise<string[]> {
  try {
    const root = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
    const response = await fetch(`${root}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name?: string }[] };
    return (data.models ?? [])
      .map((entry) => entry?.name)
      .filter((name): name is string => Boolean(name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Everything the dashboard shows, in one pass.
 *
 * The two network calls run together and each one is allowed to fail on its
 * own — a rate-limited GitHub should dim one panel, not blank the screen.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const errors: string[] = [];
  const user = getActiveUser() ?? null;

  if (!user?.id) {
    return {
      user: null,
      githubLogin: null,
      leetcodeUsername: null,
      github: null,
      leetcode: null,
      todos: { open: 0, recent: [] },
      notes: { total: 0 },
      expenses: { monthTotal: 0, monthCount: 0, currency: "INR" },
      errors: ["Not signed in. Run `swale` in a terminal to connect GitHub."],
    };
  }

  const githubConnection = fetchLoginByProvider(user.id, "github");
  const leetcodeConnection = fetchLoginByProvider(user.id, "leetcode");
  const githubLogin = githubConnection?.success ? githubConnection.login : null;
  const leetcodeUsername = leetcodeConnection?.success ? leetcodeConnection.login : null;
  const window = CALENDAR_WEEKS * 7;

  const [githubResult, leetcodeResult] = await Promise.allSettled([
    githubLogin ? getContributionCalendar(githubLogin, window) : Promise.resolve(null),
    leetcodeUsername ? getLeetcodeProfileDetails(leetcodeUsername) : Promise.resolve(null),
  ]);

  let github: DashboardSnapshot["github"] = null;
  if (githubResult.status === "fulfilled" && githubResult.value) {
    const days = fillCalendarWindow(githubResult.value.days, window);
    github = { days, stats: calendarStats(days), total: githubResult.value.total };
  } else if (githubLogin) {
    errors.push("GitHub contributions could not be loaded.");
  }

  let leetcode: DashboardSnapshot["leetcode"] = null;
  if (leetcodeResult.status === "fulfilled" && leetcodeResult.value) {
    const profile = leetcodeResult.value;
    const days = fillCalendarWindow(leetcodeCalendarToDays(profile.submissionCalendar), window);
    leetcode = { days, stats: calendarStats(days), profile };
  } else if (leetcodeUsername) {
    errors.push("LeetCode profile could not be loaded.");
  }

  const statusCounts = countTodosByStatus(user.id);
  const open = statusCounts
    .filter((row) => row.status !== "done")
    .reduce((sum, row) => sum + row.total, 0);

  const now = new Date();
  const monthStart = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const spend = summariseExpenses(user.id, monthStart);

  return {
    user,
    githubLogin,
    leetcodeUsername,
    github,
    leetcode,
    todos: {
      open,
      recent: listTodos(user.id).map((todo: any) => ({
        id: String(todo?.id ?? ""),
        text: String(todo?.text ?? ""),
        status: String(todo?.status ?? "todo"),
      })),
    },
    notes: { total: countNotes(user.id) },
    expenses: {
      monthTotal: spend.total,
      monthCount: spend.count,
      currency: user.currency ?? "INR",
    },
    errors,
  };
}

/**
 * `swale chat` — a REPL over the agent.
 *
 * The whole transcript goes back every turn, so "and the week before?" means
 * something. A fresh prompt array each time would make every question the
 * first one.
 */
export async function streamChat() {
  let llm = getLlmDetails();
  if (!llm) {
    const status = await askForLLMDetails();
    if (!status?.success) {
      console.error("Something is wrong in the LLM configuration");
      process.exit(1);
    }
  }
  llm = getLlmDetails();
  if (!llm) {
    console.error("ERROR_NO_LLM_FOUND");
    process.exit(1);
  }

  const ctx = resolveAgentContext();
  if (!ctx) {
    console.error("ERROR_NO_USER_FOUND");
    process.exit(1);
  }

  console.log(
    chalk.hex(COLORS.ORANGE).bold(`\nswale chat`) +
      chalk.gray(` — ${llm.model} via ${llm.type === "local" ? llm.baseUrl : llm.provider}`),
  );
  console.log(chalk.gray("Ask about your todos, notes, spending, GitHub or LeetCode."));
  console.log(chalk.gray("Ctrl+C to leave.\n"));

  const history: ModelMessage[] = [];

  for (;;) {
    const prompt = await input({ message: chalk.hex(COLORS.ORANGE)("you ›") });
    if (!prompt.trim().length) continue;
    if (["exit", "quit", ":q"].includes(prompt.trim().toLowerCase())) return;

    history.push({ role: "user", content: prompt });

    let streamed = false;
    try {
      const { text } = await runAgent(ctx, {
        messages: history,
        onToolCall: ({ name }) => {
          process.stdout.write(chalk.gray(`  ⚙ ${name}\n`));
        },
        onText: (chunk) => {
          if (!streamed) {
            process.stdout.write(chalk.cyan("swale › "));
            streamed = true;
          }
          process.stdout.write(chunk);
        },
      });

      process.stdout.write("\n\n");
      history.push({ role: "assistant", content: text });
    } catch (error) {
      console.error(chalk.red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
      history.pop();
    }
  }
}
