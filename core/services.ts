// library imports
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { select } from "@inquirer/prompts";
// node imports
import readline from "readline/promises";
// local imports
import {
  LEETCODE_GRAPHQL_URL,
  LEETCODE_PROFILE_URL,
  SWALE_GITHUB_ISSES_LINK,
} from "./constants.js";
import { createUserObject, insertUser, listAllUsers, loginUser } from "./users/main.js";
import { createOrUpdateConfig, getGithubAuth } from "./utils.js";
import type { LeetcodeBasicDetailsMeta, LeetcodeProfileDetails } from "./models.js";
import { getGithubUserProfileDetails, getOctokit } from "./octokit.js";
import {
  createConnectionsObject,
  insertConnection,
  validateGithubLoginWithExistingConnection,
} from "./connections/main.js";

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
  const query = `
    query getProfileDetails($username: String!) {
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
        userCalendar {
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
      userCalendar: { submissionCalendar: string };
    };
    allQuestionsCount: { difficulty: string; count: number }[];
    recentSubmissionList: {
      title: string;
      titleSlug: string;
      timestamp: string;
      statusDisplay: string;
      lang: string;
    }[];
  }>(query, { username });

  const totalSolved =
    data.matchedUser.submitStats.acSubmissionNum.find((d) => d.difficulty === "All")?.count ?? 0;

  const totalQuestions = data.allQuestionsCount.find((d) => d.difficulty === "All")?.count ?? 0;

  const totalSubmissions = data.matchedUser.submitStats.acSubmissionNum.map((d) => ({
    difficulty: d.difficulty as "All" | "Easy" | "Medium" | "Hard",
    count: d.count,
    submissions: d.submissions,
  }));

  const submissionCalendar: { [key: string]: number } = JSON.parse(
    data.matchedUser.userCalendar.submissionCalendar || "{}",
  );

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
  if (!process.stdin.isTTY) {
    console.error("Swale needs an interactive terminal to function.");
    process.exit(1);
  }

  // @TODO - refactor this function
  const existingAuth = getGithubAuth();
  if (!existingAuth?.token) {
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
