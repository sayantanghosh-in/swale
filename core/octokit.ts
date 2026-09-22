import { Octokit } from "octokit";
import type { GithubRepositoryDetails, GithubUserProfileDetails } from "./models.js";

type OctokitOptions = ConstructorParameters<typeof Octokit>[0];

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

export async function listRepositories(): Promise<GithubRepositoryDetails | null> {
  if (!oct) {
    return null;
  }

  // Get the list of repositories
  const res = await oct.request("/users/sayantanghosh-in/repos?per_page=2&sort=updated", {
    headers: {
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  return { res };
}
