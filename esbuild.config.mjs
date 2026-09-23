import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import console from "console";

const prod = process.argv[2] === "production";

const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
	if (
		name === `warning` &&
		typeof data === `object` &&
		data.name === `ExperimentalWarning`
		//if you want to only stop certain messages, test for the message here:
		//&& data.message.includes(`Fetch API`)
	) {
		return false;
	}
	return originalEmit.apply(process, arguments);
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	tsconfig: "tsconfig.build.json",
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	console.log("Building for production");
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
