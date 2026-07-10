import * as THREE from 'three/webgpu';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export const SharedTextureLoader = new THREE.TextureLoader();

/**
 * TextureCache - Singleton for centralized texture loading and caching
 *
 * Provides:
 * - Cached texture loading to prevent duplicate loads
 * - 3D noise texture generation with caching
 * - Proper disposal of all cached textures
 */
class TextureCacheFactory {
	private textureLoader: THREE.TextureLoader;
	private ktx2Loader: KTX2Loader | null = null;
	// `.ktx2` loads requested before setKTX2Loader (e.g. the transition mask,
	// which kicks off during the post-graph build inside renderer.init) wait
	// here and flush once the loader registers.
	private ktx2LoaderWaiters: Array<(loader: KTX2Loader) => void> = [];
	private textureCache: Map<string, THREE.Texture> = new Map();
	private pendingTextureLoads: Map<string, Promise<THREE.Texture>> = new Map();
	private noiseTextureCache: Map<string, THREE.Data3DTexture> = new Map();

	constructor() {
		this.textureLoader = SharedTextureLoader;
	}

	/**
	 * Register the shared KTX2Loader so `.ktx2` URLs route through GPU-transcoded
	 * decoding instead of the default image-based loader. Call after
	 * `detectSupport(renderer)` on the loader; `.ktx2` loads requested earlier
	 * are queued and start here.
	 */
	setKTX2Loader(loader: KTX2Loader): void {
		this.ktx2Loader = loader;
		const waiters = this.ktx2LoaderWaiters;
		this.ktx2LoaderWaiters = [];
		for (const waiter of waiters) waiter(loader);
	}

	private whenKTX2Loader(): Promise<KTX2Loader> {
		if (this.ktx2Loader) return Promise.resolve(this.ktx2Loader);
		return new Promise((resolve) => this.ktx2LoaderWaiters.push(resolve));
	}

	/**
	 * Load a texture from URL with caching
	 * Returns cached texture if already loaded
	 */
	load(url: string): Promise<THREE.Texture> {
		const cached = this.textureCache.get(url);
		if (cached) {
			return Promise.resolve(cached);
		}

		const pending = this.pendingTextureLoads.get(url);
		if (pending) {
			return pending;
		}

		const isKTX2 = url.toLowerCase().endsWith('.ktx2');

		const loadPromise = new Promise<THREE.Texture>((resolve, reject) => {
			const onLoad = (texture: THREE.Texture) => {
				this.textureCache.set(url, texture);
				this.pendingTextureLoads.delete(url);
				resolve(texture);
			};
			const onError = (error: unknown) => {
				this.pendingTextureLoads.delete(url);
				reject(error);
			};
			if (isKTX2) {
				void this.whenKTX2Loader().then((loader) =>
					loader.load(url, onLoad, undefined, onError)
				);
			} else {
				this.textureLoader.load(url, onLoad, undefined, onError);
			}
		});

		this.pendingTextureLoads.set(url, loadPromise);
		return loadPromise;
	}

	/**
	 * Synchronously load a texture (uses TextureLoader.load callback pattern)
	 * Returns cached texture immediately if available
	 */
	loadSync(url: string): THREE.Texture {
		// Return cached texture if available
		const cached = this.textureCache.get(url);
		if (cached) {
			return cached;
		}

		const texture = this.textureLoader.load(url);
		this.textureCache.set(url, texture);
		return texture;
	}

	/**
	 * Create a 3D Perlin noise texture with caching
	 *
	 * @param size Size of the 3D texture (size x size x size)
	 * @param scale Noise scale multiplier
	 * @param repeatFactor UV repeat factor for tiling
	 * @returns Cached 3D texture
	 */
	create3DNoise(size: number = 128, scale: number = 10, repeatFactor: number = 5.0): THREE.Data3DTexture {
		const cacheKey = `noise_${size}_${scale}_${repeatFactor}`;

		// Return cached noise texture if available
		const cached = this.noiseTextureCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		// Generate new 3D noise texture
		let i = 0;
		const data = new Uint8Array(size * size * size);
		const perlin = new ImprovedNoise();

		for (let z = 0; z < size; z++) {
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					const nx = (x / size) * repeatFactor;
					const ny = (y / size) * repeatFactor;
					const nz = (z / size) * repeatFactor;

					const noiseValue = perlin.noise(nx * scale, ny * scale, nz * scale);
					data[i] = 128 + 128 * noiseValue;
					i++;
				}
			}
		}

		const texture = new THREE.Data3DTexture(data, size, size, size);
		texture.format = THREE.RedFormat;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.wrapR = THREE.RepeatWrapping;
		texture.unpackAlignment = 1;
		texture.needsUpdate = true;

		this.noiseTextureCache.set(cacheKey, texture);
		return texture;
	}

	/**
	 * Get a texture from cache without loading
	 */
	get(url: string): THREE.Texture | undefined {
		return this.textureCache.get(url);
	}

	/**
	 * Check if a texture is cached
	 */
	has(url: string): boolean {
		return this.textureCache.has(url);
	}

	/**
	 * Dispose all cached textures
	 */
	dispose(): void {
		this.pendingTextureLoads.clear();

		for (const texture of this.textureCache.values()) {
			texture.dispose();
		}
		this.textureCache.clear();

		for (const texture of this.noiseTextureCache.values()) {
			texture.dispose();
		}
		this.noiseTextureCache.clear();
	}

	/**
	 * Dispose a specific texture by URL
	 */
	disposeTexture(url: string): void {
		const texture = this.textureCache.get(url);
		if (texture) {
			texture.dispose();
			this.textureCache.delete(url);
		}
	}
}

// Export singleton instance
export const TextureCache = new TextureCacheFactory();
