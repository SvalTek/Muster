import { MusterError } from "./app/store.ts";
import { installHerdr, type HerdrInstallOptions } from "./targets/herdr/installer.ts";
import { uninstallHerdr } from "./targets/herdr/uninstaller.ts";

/** Dispatch installation targets; Herdr is the default target. */
export async function install(target: string, options: HerdrInstallOptions) {
  if (target && target !== "herdr") throw new MusterError("usage", `Unknown install target: ${target}. Available target: herdr.`);
  return installHerdr(options);
}

export function uninstall(target: string, options: { appHome?: string }) {
  if (target && target !== "herdr") throw new MusterError("usage", `Unknown uninstall target: ${target}. Available target: herdr.`);
  return uninstallHerdr(options);
}
