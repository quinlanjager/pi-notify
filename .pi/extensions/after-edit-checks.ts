import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

type CmdResult = {
	code: number;
	stdout: string;
	stderr: string;
};

function runCmd(
	cwd: string,
	cmd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<CmdResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			signal,
			env: process.env,
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr?.on("data", (d) => {
			stderr += d.toString();
		});

		child.on("close", (code) => {
			resolve({ code: code ?? 0, stdout, stderr });
		});

		child.on("error", (err) => {
			resolve({ code: 1, stdout, stderr: stderr + String(err) });
		});
	});
}

function headLines(text: string, maxLines: number): string {
	const lines = text.split(/\r?\n/);
	return lines.slice(0, maxLines).join("\n");
}

export default function afterEditChecks(pi: ExtensionAPI) {
	const touchedPaths = new Set<string>();

	// serialize runs; avoid dogpile if multiple turns happen fast
	let queue: Promise<void> = Promise.resolve();

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!ctx.isProjectTrusted()) {
			return;
		}
		if (!ctx.hasUI) {
			return;
		}

		if (event.toolName !== "edit" && event.toolName !== "write") {
			return;
		}

		const p = (event.args as { path?: unknown } | undefined)?.path;
		if (typeof p === "string" && p.length > 0) {
			touchedPaths.add(p);
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.isProjectTrusted()) {
			return;
		}
		if (!ctx.hasUI) {
			return;
		}
		if (touchedPaths.size === 0) {
			return;
		}

		const paths = [...touchedPaths];
		touchedPaths.clear();

		queue = queue
			.then(async () => {
				ctx.ui.setStatus("after-edit-checks", "biome+tsc...");

				// keep commands simple; run full project checks.
				// format may rewrite files; user can stage/commit after.
				const fmt = await runCmd(ctx.cwd, "bunx", [
					"biome",
					"format",
					"--write",
					".",
				]);

				const lint = await runCmd(ctx.cwd, "bunx", ["biome", "lint", "."]);

				const tsc = await runCmd(ctx.cwd, "bunx", ["tsc", "--noEmit"]);

				const ok = fmt.code === 0 && lint.code === 0 && tsc.code === 0;

				if (ok) {
					ctx.ui.setStatus("after-edit-checks", "ok");
					ctx.ui.setWidget("after-edit-checks", [
						`edited: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? "..." : ""}`,
						"biome format: ok",
						"biome lint: ok",
						"tsc: ok",
					]);
					return;
				}

				const out = [
					fmt.code !== 0
						? `biome format (exit ${fmt.code})\n${headLines(fmt.stderr || fmt.stdout, 25)}`
						: "",
					lint.code !== 0
						? `biome lint (exit ${lint.code})\n${headLines(lint.stderr || lint.stdout, 25)}`
						: "",
					tsc.code !== 0
						? `tsc (exit ${tsc.code})\n${headLines(tsc.stderr || tsc.stdout, 25)}`
						: "",
				]
					.filter(Boolean)
					.join("\n\n");

				ctx.ui.setStatus("after-edit-checks", "failed");
				ctx.ui.setWidget("after-edit-checks", [
					`edited: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? "..." : ""}`,
					out,
				]);
				ctx.ui.notify("after-edit-checks: failed (see widget)", "error");
			})
			.catch((err) => {
				ctx.ui.setStatus("after-edit-checks", "error");
				ctx.ui.notify(`after-edit-checks error: ${String(err)}`, "error");
			});
	});
}
