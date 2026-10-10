import { Octokit } from "octokit";
import type {
  CalendarDay,
  GithubContributions,
  GithubRepositoryDetails,
  GithubUserProfileDetails,
} from "./models.js";

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

/**
 * The contribution calendar. REST has no endpoint for this, so it is GraphQL —
 * `read:user` is enough, which is what swale already asks for.
 */
export async function getContributionCalendar(
  login: string,
  days: number = 182,
): Promise<GithubContributions | null> {
  if (!oct || !login) {
    return null;
  }

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);

  const query = `
    query contributions($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await oct.graphql<{
      user: {
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: number;
            weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
          };
        };
      };
    }>(query, { login, from: from.toISOString(), to: to.toISOString() });

    const calendar = data?.user?.contributionsCollection?.contributionCalendar;
    if (!calendar) return null;

    const flattened: CalendarDay[] = calendar.weeks.flatMap((week) =>
      week.contributionDays.map((day) => ({ date: day.date, count: day.contributionCount })),
    );

    return { total: calendar.totalContributions, days: flattened };
  } catch {
    // A private profile or a revoked token should dim one panel, not kill the command.
    return null;
  }
}

export type GithubPeriodStats = {
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  repos: { name: string; language: string | null; commits: number }[];
  days: CalendarDay[];
};

/**
 * Activity totals for one window. GitHub caps a contributions window at a
 * year, so "all time" in swale means the last twelve months.
 */
export async function getContributionStats(
  login: string,
  from: Date,
  to: Date,
): Promise<GithubPeriodStats | null> {
  if (!oct || !login) return null;

  const query = `
    query stats($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          totalPullRequestReviewContributions
          commitContributionsByRepository(maxRepositories: 5) {
            repository { name primaryLanguage { name } }
            contributions { totalCount }
          }
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }
  `;

  try {
    const data = await oct.graphql<any>(query, {
      login,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const c = data?.user?.contributionsCollection;
    if (!c) return null;
    return {
      commits: c.totalCommitContributions ?? 0,
      pullRequests: c.totalPullRequestContributions ?? 0,
      issues: c.totalIssueContributions ?? 0,
      reviews: c.totalPullRequestReviewContributions ?? 0,
      repos: (c.commitContributionsByRepository ?? []).map((entry: any) => ({
        name: entry?.repository?.name ?? "",
        language: entry?.repository?.primaryLanguage?.name ?? null,
        commits: entry?.contributions?.totalCount ?? 0,
      })),
      days: (c.contributionCalendar?.weeks ?? []).flatMap((week: any) =>
        (week?.contributionDays ?? []).map((day: any) => ({
          date: day.date,
          count: day.contributionCount,
        })),
      ),
    };
  } catch {
    return null;
  }
}
