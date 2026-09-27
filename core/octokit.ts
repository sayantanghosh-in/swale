import { Octokit } from "octokit";
import type { GithubRepositoryDetails, GithubUserProfileDetails } from "./models.js";

type OctokitOptions = ConstructorParameters<typeof Octokit>[0];

const DEFAULT_REPO_LIMIT = 5;
const MAX_REPO_LIMIT = 100; // GitHub's per_page ceiling

let oct: Octokit | null = null;

export const getOctokit = (config: OctokitOptions): Octokit | null => {
  if (oct === null) {
    oct = new Octokit(config);
  }
  return oct;
};

export async function getGithubUserProfileDetails(): Promise<GithubUserProfileDetails | null> {
  if (!oct) {
    return null;
  }
  // get the user details and set it to the users table
  const res = await oct.request("/user", {
    headers: {
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });

  // create the user
  const name = res?.data?.name || res?.data?.login; // if name is private, use the username
  const email = res?.data?.email;

  return {
    name,
    email,
    res,
  };
}

/**
 * Recently updated repositories for `login`.
 *
 * Uses /users/{login}/repos rather than /user/repos on purpose: the latter
 * needs the `repo` scope to return anything, and swale deliberately asks for
 * read:user and user:email only.
 */
export async function listRepositories(
  login: string,
  limit: number = DEFAULT_REPO_LIMIT,
): Promise<GithubRepositoryDetails | null> {
  if (!oct || !login) {
    return null;
  }

  const perPage = Math.min(Math.max(limit, 1), MAX_REPO_LIMIT);

  const res = await oct.request("GET /users/{username}/repos", {
    username: login,
    per_page: perPage,
    sort: "updated",
    headers: {
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });

  return { res };
}
