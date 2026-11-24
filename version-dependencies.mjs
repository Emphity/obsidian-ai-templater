// Prints dependency changes between a git ref and the current package.json.
// The auto-release workflow uses this to generate readable release notes.
//
// Usage:
//   BASE_REF=<commit-ish> node version-dependencies.mjs

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseRef = process.env.BASE_REF;

const readPackageAt = (ref) =>
	JSON.parse(
		execSync(`git show ${ref}:package.json`, {
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		}),
	);

const dependencyNames = (dependencies) => new Set(Object.keys(dependencies ?? {}));

const diffDependencies = (previous, current) => {
	const dependencyGroups = [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	];
	const names = new Set();
	for (const group of dependencyGroups) {
		for (const name of dependencyNames(previous[group])) names.add(name);
		for (const name of dependencyNames(current[group])) names.add(name);
	}
	const changes = [];
	for (const name of names) {
		const before = dependencyGroups
			.map((group) => previous[group]?.[name])
			.find((value) => value !== undefined);
		const after = dependencyGroups
			.map((group) => current[group]?.[name])
			.find((value) => value !== undefined);
		if (before !== after) {
			changes.push({
				name,
				from: before ?? "added",
				to: after ?? "removed",
			});
		}
	}
	return changes;
};

if (!baseRef) {
	console.error("BASE_REF is required.");
	process.exit(1);
}

try {
	const previous = readPackageAt(baseRef);
	const current = JSON.parse(readFileSync("package.json", "utf8"));
	for (const change of diffDependencies(previous, current)) {
		console.log(`- ${change.name}: ${change.from} -> ${change.to}`);
	}
} catch (error) {
	console.error(
		`Unable to compare dependencies with ${baseRef}: ${
			error instanceof Error ? error.message : String(error)
		}`,
	);
	process.exit(1);
}
