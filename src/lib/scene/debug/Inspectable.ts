export interface Inspectable {
	/** Create inspector GUI controls. Returns the panel for cleanup. */
	setupInspectorControls?(inspectorInstance: any): any;
	/** Export current state as a serializable, nested config object. */
	getConfig?(): Record<string, any>;
	/**
	 * Apply a (possibly partial) nested config back to this system. Called by
	 * Theatre on every value change — must accept missing keys without throwing.
	 * Theatre registration is gated on this method existing.
	 */
	applyConfig?(config: Record<string, any>): void;
	/**
	 * Optional: short display labels for Theatre's prop list, keyed by the
	 * auto-flattened prop name (e.g. `lightsSpotLightColor`). Theatre Studio
	 * truncates labels from the right, so put the discriminator at the front
	 * (`main color`, not `color (main)`) and keep them ≤ ~10 chars where you
	 * can. Anything not listed here falls back to the auto-generated label.
	 */
	getLabels?(): Record<string, string>;
}
