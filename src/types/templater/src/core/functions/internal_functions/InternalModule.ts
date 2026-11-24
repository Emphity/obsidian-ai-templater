// Minimal runtime-compatible contract for Templater's InternalModule. The
// bundle uses Templater's real class (see tsconfig.build.json); this file only
// provides an equivalent API for typechecking and for making the integration
// contract explicit.
export abstract class InternalModule {
	declare name: string;
	protected static_functions: Map<string, unknown> = new Map();
	protected dynamic_functions: Map<string, unknown> = new Map();
	protected config: { target_file: unknown } = { target_file: undefined };
	protected static_object: Record<string, unknown> = {};
	protected plugin: unknown;

	constructor(plugin: unknown) {
		this.plugin = plugin;
	}

	getName(): string {
		return this.name;
	}

	async init(): Promise<void> {
		await this.create_static_templates();
		this.static_object = Object.fromEntries(this.static_functions);
	}

	async generate_object(new_config: {
		target_file: unknown;
	}): Promise<Record<string, unknown>> {
		this.config = new_config;
		await this.create_dynamic_templates();
		return {
			...this.static_object,
			...Object.fromEntries(this.dynamic_functions),
		};
	}

	abstract create_static_templates(): Promise<void>;
	abstract create_dynamic_templates(): Promise<void>;
	abstract teardown(): Promise<void>;
}
