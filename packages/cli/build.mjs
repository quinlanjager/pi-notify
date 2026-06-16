import { build } from "esbuild";

await build({
	entryPoints: ["src/cli.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: "bin/cli.js",
	external: ["zeromq", "pi-notify"],
});
