import { Octokit } from "octokit";

type OctokitOptions = ConstructorParameters<typeof Octokit>[0];

let oct: Octokit | null = null;

export const getOctokit = (config: OctokitOptions): Octokit | null => {
  if (oct === null) {
    oct = new Octokit(config);
  }
  return oct;
};
