// creates and removes a visual indicator element that is appended to the active workspace leaf's view header
// provides user feedback that the plugin is working on a AI task

class ActivityIndicator {
	private spinner: HTMLDivElement | null = null;
	private timerId: ReturnType<typeof setTimeout> | null = null;

	add(): void {
		// Create the parent div
		this.spinner = activeDocument.createDiv();
		this.spinner.className = "ait-spinner";

		// Create the child divs
		const bounceDelays = ["-0.42s", "-0.36s", "-0.16s", "0s"];
		for (const delay of bounceDelays) {
			const bounce = activeDocument.createDiv();
			bounce.className = "oil-bounce";
			bounce.style.setProperty("--bounce-delay", delay);
			this.spinner?.appendChild(bounce);
		}

		// Append the spinner to the active workspace leaf's view header
		const activeViewHeader = activeDocument.querySelector(
			".workspace-leaf.mod-active .cm-scroller",
		);
		if (activeViewHeader) activeViewHeader.after(this.spinner);

		// Remove the spinner after a brief period in case the task gets stuck
		this.timerId = activeWindow.setTimeout(() => {
			this.remove();
		}, 120000);
	}

	remove(): void {
		// Clear the timer if it's still running
		if (this.timerId) {
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
