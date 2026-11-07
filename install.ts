import { MusterError } from "./app/store.ts";
import { installHerdr, type HerdrInstallOptions } from "./targets/herdr/installer.ts";

/** Dispatch installation targets; Herdr is the default target. */
export async function install(target: string, options: HerdrInstallOptions) {
  if (target && target !== "herdr") throw new MusterError("usage", `Unknown install target: ${target}. Available target: herdr.`);
  return installHerdr(options);
}
