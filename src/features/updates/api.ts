import { invoke } from "@tauri-apps/api/core";
import { GITHUB_REPO } from "../../shared/lib/links";

export type UpdateStatus = {
  available: boolean;
  version: string | null;
};

export async function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("get_update_status");
}

export type GithubRelease = {
  tag_name: string;
  body: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
};

export async function getGithubReleases(
  limit: number,
): Promise<GithubRelease[]> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${limit}`,
    { headers: { Accept: "application/vnd.github.v3+json" } },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }
  return response.json() as Promise<GithubRelease[]>;
}
