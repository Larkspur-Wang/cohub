import type { Command } from "commander";
import { uploadAvatarAsset } from "../avatar.js";
import { createClient } from "../client.js";
import { json as outJson, jsonRequested, ok, error, handleHttp } from "../output.js";

type ProfileUpdateOptions = {
  username?: string;
  displayName?: string;
  json?: boolean;
};

export function registerProfile(program: Command): void {
  const profileCmd = program.command("profile").description("Manage your profile");

  profileCmd
    .command("update")
    .description("Update your profile")
    .option("--username <username>", "Public username")
    .option("--display-name <name>", "Display name")
    .option("--json", "Output as JSON")
    .action(async (opts: ProfileUpdateOptions) => {
      const input = {
        username: opts.username,
        displayName: opts.displayName,
      };
      if (input.username === undefined && input.displayName === undefined) {
        return error("Nothing to update", "Pass --username or --display-name.");
      }

      const client = createClient();
      try {
        const result = await client.user.updateProfile(input);
        if (jsonRequested(opts)) return outJson(result);
        ok("Profile updated");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  profileCmd
    .command("avatar <path>")
    .description("Upload your avatar")
    .option("--json", "Output as JSON")
    .action(async (path: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const asset = await uploadAvatarAsset({ client, purpose: "user_avatar", path });
        const result = await client.user.updateProfile({ avatarUrl: asset.publicUrl });
        if (jsonRequested(opts)) return outJson({ ...result, asset });
        ok("Avatar updated");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
