import { readFileSync } from "node:fs";
import path from "node:path";
import type { PackageJsonContents } from "./models.js";

export const parsePackageJsonContents = (): PackageJsonContents => {
  const packageJsonFileData: PackageJsonContents = {
    description: "",
    name: "",
    version: "",
  };
  try {
    const data = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const parsedPackageJson = JSON.parse(data);
    packageJsonFileData["description"] = parsedPackageJson["description"] || "";
    packageJsonFileData["name"] = parsedPackageJson["name"] || "";
    packageJsonFileData["version"] = parsedPackageJson["version"] || "";
  } catch (err) {
    console.error(err);
  }

  return packageJsonFileData;
};
