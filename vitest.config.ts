import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";
import UnpluginTypia from "@typia/unplugin/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	plugins: [UnpluginTypia({})],
	resolve: {
		alias: {
			"@": path.resolve(root, "."),
		},
	},
	test: {
		environment: "node",
	},
});
