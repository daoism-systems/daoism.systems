import * as THREE from 'three';
import type { Inspectable } from './Inspectable';

export interface SceneInspectorDeps {
	camera?: THREE.PerspectiveCamera;
	scene?: THREE.Scene;
	lenisInstance?: { instance: any };
	virtualScrollHeight?: { h: number };
}

/**
 * SceneInspector - Thin orchestrator for debug parameter panels.
 *
 * Each subsystem owns its own `setupInspectorControls()`.
 * SceneInspector only handles the page/scroll panel and delegates to
 * registered subsystems.
 */
export class SceneInspector {
	private inspectorInstance: any;
	private deps: SceneInspectorDeps;
	private subsystems = new Map<string, Inspectable>();
	private subsystemPanels = new Map<string, any>();
	private pageObj = {
		scrollHeight: 5000,
		scrollLerp: 0.1,
		wheelMultiplier: 1,
		touchMultiplier: 1
	};

	constructor(inspectorInstance: any, deps: SceneInspectorDeps) {
		this.inspectorInstance = inspectorInstance;
		this.deps = deps;
	}

	/** Register a subsystem that implements Inspectable */
	public register(key: string, subsystem: Inspectable): void {
		this.subsystems.set(key, subsystem);
	}

	/** Unregister a subsystem and destroy its panel */
	public unregister(key: string): void {
		const panel = this.subsystemPanels.get(key);
		if (panel) {
			this.destroyPanel(panel);
			this.subsystemPanels.delete(key);
		}
		this.subsystems.delete(key);
	}

	/**
	 * Setup all inspector panels.
	 * Call once after initial registration, or again after registering late subsystems.
	 */
	public setup(): void {
		this.setupPageControls();

		// Delegate to each registered subsystem
		for (const [key, subsystem] of this.subsystems) {
			if (subsystem.setupInspectorControls) {
				const panel = subsystem.setupInspectorControls(this.inspectorInstance, this.deps.scene);
				if (panel) this.subsystemPanels.set(key, panel);
			}
		}
	}

	/**
	 * Register and immediately setup a late-arriving subsystem.
	 * Use for subsystems loaded after the initial setup() call (materials, particles, smoke).
	 */
	public registerAndSetup(key: string, subsystem: Inspectable): void {
		// Destroy existing panel if re-registering
		const existing = this.subsystemPanels.get(key);
		if (existing) this.destroyPanel(existing);

		this.subsystems.set(key, subsystem);
		if (subsystem.setupInspectorControls) {
			const panel = subsystem.setupInspectorControls(this.inspectorInstance, this.deps.scene);
			if (panel) this.subsystemPanels.set(key, panel);
		}
	}

	// ── Scene-level panels ──────────────────────────────────────────

	private setupPageControls(): void {
		const { lenisInstance, virtualScrollHeight } = this.deps;
		if (!lenisInstance?.instance) return;

		const lenis = lenisInstance.instance;
		const gui = this.inspectorInstance.createParameters('Page / Scroll');
		gui.close();
		this.pageObj = {
			scrollHeight: virtualScrollHeight?.h ?? 5000,
			scrollLerp: lenis.options.lerp,
			wheelMultiplier: lenis.options.wheelMultiplier,
			touchMultiplier: lenis.options.touchMultiplier
		};

		gui
			.add(this.pageObj, 'scrollHeight', 3000, 20000, 100)
			.name('Scroll Height (px)')
			.onChange((v: number) => {
				if (virtualScrollHeight) virtualScrollHeight.h = v;
				lenis.resize();
			});

		const scrollFolder = gui.addFolder('Lenis Scroll');
		scrollFolder
			.add(this.pageObj, 'scrollLerp', 0.01, 1.0, 0.01)
			.name('Lerp')
			.onChange((v: number) => {
				lenis.options.lerp = v;
			});
		scrollFolder
			.add(this.pageObj, 'wheelMultiplier', 0.1, 5.0, 0.1)
			.name('Wheel Multiplier')
			.onChange((v: number) => {
				lenis.options.wheelMultiplier = v;
			});
		scrollFolder
			.add(this.pageObj, 'touchMultiplier', 0.1, 5.0, 0.1)
			.name('Touch Multiplier')
			.onChange((v: number) => {
				lenis.options.touchMultiplier = v;
			});
	}

	// ── Utilities ───────────────────────────────────────────────────

	private destroyPanel(panel: any): void {
		if (!panel) return;
		if (Array.isArray(panel)) {
			for (const p of panel) this.destroySinglePanel(p);
			return;
		}
		this.destroySinglePanel(panel);
	}

	private destroySinglePanel(panel: any): void {
		if (!panel) return;
		try {
			const item = panel.paramList;
			if (item?.parent) {
				item.parent.remove(item);
			}
			const params = panel.parameters;
			if (params?.groups) {
				const idx = params.groups.indexOf(panel);
				if (idx !== -1) params.groups.splice(idx, 1);
			}
		} catch {
			// Inspector may have already cleaned it up
		}
	}

	public destroy(): void {
		for (const [, panel] of this.subsystemPanels) {
			this.destroyPanel(panel);
		}
		this.subsystemPanels.clear();
		this.subsystems.clear();
		this.inspectorInstance = null;
		this.deps = null!;
	}
}

export default SceneInspector;
