/**
 * Custom text splitting utility.
 *
 * The `revert()` method restores the original innerHTML.
 */

export interface SplitTextOptions {
	/** Wrap each char in an overflow:hidden mask so it can slide in from below. */
	mask?: boolean;
	wordsClass?: string;
	charsClass?: string;
}

export interface SplitResult {
	words: HTMLElement[];
	chars: HTMLElement[];
	revert(): void;
}

// The mask crops at the char's line box, which is shorter than glyph descenders
// under the tight heading line-heights used here. The char pads downward by this
// amount to give descenders room, and the mask pulls the same amount back with a
// negative margin so line-box height is unchanged. Ancestors must not clip flush
// to the line box (no snug overflow:hidden) or the padded region is cut off.
const DESCENDER_PAD = '0.2em';

/**
 * Split an element's text content into word spans containing individually
 * addressable character spans. Words stay intact as inline-blocks so lines can
 * only break at spaces, never mid-word. Whitespace is preserved as text nodes
 * between words, so word-spacing still applies.
 *
 * @param el      The container element whose text will be split.
 * @param options Configuration for the split behavior.
 * @returns       A SplitResult with references to created spans and a revert() method.
 */
export function splitText(el: HTMLElement, options: SplitTextOptions = {}): SplitResult {
	const originalHTML = el.innerHTML;
	const wordsClass = options.wordsClass ?? 'word';
	const charsClass = options.charsClass ?? 'char';
	const mask = options.mask ?? false;

	const words: HTMLElement[] = [];
	const chars: HTMLElement[] = [];

	// Walk text nodes (including nested ones) and wrap them while preserving markup.
	const fragment = document.createDocumentFragment();
	const childNodes = Array.from(el.childNodes);

	const appendSplitText = (text: string, parent: Node) => {
		const wordTexts = text.split(/(\s+)/);

		for (const wordText of wordTexts) {
			if (!wordText) continue;

			// Whitespace — preserve as-is
			if (/^\s+$/.test(wordText)) {
				parent.appendChild(document.createTextNode(wordText));
				continue;
			}

			const wordSpan = document.createElement('span');
			wordSpan.className = wordsClass;
			wordSpan.style.display = 'inline-block';

			for (const char of wordText) {
				const charEl = createCharSpan(char, charsClass, mask);
				wordSpan.appendChild(charEl);
				chars.push(mask ? (charEl.querySelector(`.${charsClass}`) as HTMLElement) : charEl);
			}

			parent.appendChild(wordSpan);
			words.push(wordSpan);
		}
	};

	const processNode = (node: Node, parent: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			appendSplitText(node.textContent ?? '', parent);
			return;
		}

		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as HTMLElement;
			const clone = element.cloneNode(false) as HTMLElement;
			const nestedNodes = Array.from(element.childNodes);

			if (nestedNodes.length) {
				for (const nestedNode of nestedNodes) {
					processNode(nestedNode, clone);
				}
			}

			parent.appendChild(clone);
			return;
		}

		parent.appendChild(node.cloneNode(true));
	};

	for (const node of childNodes) {
		processNode(node, fragment);
	}

	el.innerHTML = '';
	el.appendChild(fragment);

	return {
		words,
		chars,
		revert() {
			el.innerHTML = originalHTML;
		}
	};
}

/**
 * Create a character span, optionally with a mask wrapper (overflow: hidden).
 *
 * Without mask:  <span class="char" style="display:inline-block">A</span>
 * With mask:     <span style="display:inline-block;overflow:hidden">
 *                  <span class="char" style="display:inline-block;padding-bottom:0.2em">A</span>
 *                </span>
 */
function createCharSpan(char: string, className: string, mask: boolean): HTMLElement {
	const charSpan = document.createElement('span');
	charSpan.className = className;
	charSpan.style.display = 'inline-block';
	charSpan.textContent = char;

	if (!mask) return charSpan;

	charSpan.style.paddingBottom = DESCENDER_PAD;

	const wrapper = document.createElement('span');
	wrapper.style.display = 'inline-block';
	wrapper.style.overflow = 'hidden';
	// An overflow:hidden inline-block baseline-aligns to its bottom margin edge,
	// which would misalign it against sibling text; align to the line-box bottom
	// instead. The negative margin cancels the descender pad's added height.
	wrapper.style.verticalAlign = 'bottom';
	wrapper.style.marginBottom = `-${DESCENDER_PAD}`;
	wrapper.appendChild(charSpan);
	return wrapper;
}
