import { build } from "esbuild";
import { fileURLToPath } from "url";
import UnpluginTypia from "@typia/unplugin/esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));

await build({
	entryPoints: ["index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: "dist/index.js",
	external: ["zeromq", "@earendil-works/pi-coding-agent"],
	alias: {
		"@": root,
	},
	plugins: [UnpluginTypia({})],
});
