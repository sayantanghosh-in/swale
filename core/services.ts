// library imports
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { select } from "@inquirer/prompts";
// node imports
import readline from "readline/promises";
// local imports
import {
  LEETCODE_ALFA_URL,
  LEETCODE_API_ROUTES,
  LEETCODE_PROFILE_URL,
  SWALE_GITHUB_ISSES_LINK,
} from "./constants.js";
import { createUserObject, insertUser, listAllUsers, loginUser } from "./users/main.js";
import { createOrUpdateConfig, getGithubAuth } from "./utils.js";
import type { LeetcodeBasicDetailsMeta } from "./models.js";
import { getOctokit } from "./octokit.js";
import { createConnectionsObject, insertConnection } from "./connections/main.js";

export async function getLeetcodeBasicDetails(username: string): Promise<LeetcodeBasicDetailsMeta> {
  const response = await fetch(LEETCODE_ALFA_URL + "/" + username, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const data = await response.json();
  return data as LeetcodeBasicDetailsMeta;
}

export async function getLeetcodeProfileDetails(username: string) {
  const response = await fetch(
    LEETCODE_ALFA_URL + "/" + username + LEETCODE_API_ROUTES["profile"],
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    },
  );

  const data = await response.json();
  return data;
}

const auth = createOAuthDeviceAuth({
  clientType: "oauth-app",
  clientId: process.env.SWALE_GITHUB_CLIENT_ID || "Ov23liJbUgcPQV2hYKX0",
  scopes: ["read:user", "user:email"],
  onVerification(verification) {
    // verification example
    // {
    //   device_code: "3584d83530557fdd1f46af8289938c8ef79f9dc5",
    //   user_code: "WDJB-MJHT",
    //   verification_uri: "https://github.com/login/device",
    //   expires_in: 900,
    //   interval: 5,
    // };

    console.log("Open %s", verification.verification_uri);
    console.log("Enter code: %s", verification.user_code);
  },
});

export async function onboarding() {
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
            name: `${u?.name ?? "<No Name>"}${(u?.email as string)?.trim()?.length ? "<" + u?.email + ">" : ""}`,
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
          createOrUpdateConfig({ github: tokenAuthentication });
          // create the Octokit instance
          const oc = getOctokit({ auth: tokenAuthentication?.token });
          if (!oc) {
            console.error("ERROR_UNKNOWN_AUTH_ERROR");
            return;
          }
          return;
        } else {
          console.error(loginUserResponse?.error);
          process.exit(1);
        }
      }
    }

    /**
     * The device flow and the leetcode prompt both need a human at a keyboard.
     * Without a TTY there is nobody to approve the code, so fail fast instead of
     * hanging on a prompt nobody can see.
     */
    if (!process.stdin.isTTY) {
      console.error("Swale needs an interactive terminal to connect your GitHub account.");
      process.exit(1);
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
    // get the user details and set it to the users table
    const res = await oc.request("/user", {
      headers: {
        "X-GitHub-Api-Version": "2026-03-10",
      },
    });

    // create the user
    const name = res?.data?.name || res?.data?.login; // if name is private, use the username
    const email = res?.data?.email;
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
