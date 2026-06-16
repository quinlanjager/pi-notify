import { build } from "esbuild";
import { fileURLToPath } from "url";
import UnpluginTypia from "@typia/unplugin/esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const isDebug = process.argv.includes("--debug");

const sharedOpts = {
	bundle: true,
	platform: "node",
	format: "esm",
	external: ["zeromq", "@earendil-works/pi-coding-agent"],
	alias: { "@": root },
	plugins: [UnpluginTypia({})],
};

if (isDebug) {
	await build({
		...sharedOpts,
		entryPoints: ["src/debug-cli.ts"],
		outfile: "bin/debug-cli.js",
	});
} else {
	await build({
		...sharedOpts,
		entryPoints: ["index.ts"],
		outfile: "dist/index.js",
	});
}
