// creates and removes a visual indicator for long-running AI tasks. It uses a
// fixed overlay so it remains visible even when the active editor is changed
// or closed while the request is running.

class ActivityIndicator {
	private spinner: HTMLElement | null = null;
	private timerId: number | null = null;

	add(): void {
		// built with standard DOM APIs and fully wrapped: the spinner is
		// cosmetic and must never break a chat call
		try {
			this.remove();
			const spinner = activeDocument.createElement("div");
			spinner.className = "ait-working";

			const dots = activeDocument.createElement("div");
			dots.className = "ait-working-dots";
			const bounceDelays = ["-0.32s", "-0.24s", "-0.16s", "-0.08s", "0s"];
			for (const delay of bounceDelays) {
				const bounce = activeDocument.createElement("div");
				bounce.className = "ait-working-dot";
				bounce.style.setProperty("--bounce-delay", delay);
				dots.appendChild(bounce);
			}

			const label = activeDocument.createElement("span");
			label.className = "ait-working-label";
			label.textContent = "AIT is working…";

			spinner.appendChild(dots);
			spinner.appendChild(label);
			activeDocument.body.appendChild(spinner);
			this.spinner = spinner;

			// Remove the spinner if a task gets stuck; normal removal happens
			// as soon as the template call settles.
			this.timerId = activeWindow.setTimeout(() => {
				this.remove();
			}, 300000);
		} catch (error) {
			console.log("ActivityIndicator: failed to attach spinner", error);
		}
	}

	remove(): void {
		// Clear the timer if it's still running
		if (this.timerId !== null) {
			activeWindow.clearTimeout(this.timerId);
			this.timerId = null;
		}

		// Remove the spinner
		if (this.spinner) {
			this.spinner.remove();
			this.spinner = null;
		}
	}
}

export default ActivityIndicator;
