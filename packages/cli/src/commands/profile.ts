import type { Command } from "commander";
import { uploadAvatarAsset } from "../avatar.js";
import { createClient } from "../client.js";
import { json as outJson, ok, handleHttp } from "../output.js";

export function registerProfile(program: Command): void {
  const profileCmd = program.command("profile").description("Manage your profile");

  profileCmd
    .command("avatar <path>")
    .description("Upload your avatar")
    .option("--json", "Output as JSON")
    .action(async (path: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const asset = await uploadAvatarAsset({ client, purpose: "user_avatar", path });
        const result = await client.user.updateProfile({ avatarUrl: asset.publicUrl });
        if (opts.json) return outJson({ ...result, asset });
        ok("Avatar updated");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
