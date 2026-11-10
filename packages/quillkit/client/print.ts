// The print door: the PDF the download writes, handed to the browser's print dialog
// (INVARIANTS §"Print").

/** A print begun on a press, finished once the PDF is in hand. */
export interface Printing {
	/** Print `pdf`. Returns false where the browser refused every way in. */
	print(pdf: Uint8Array): boolean;
	/** Drop a print that has nothing to print. */
	cancel(): void;
}

/**
 * Whether this browser prints a PDF from a hidden frame. A browser without an inline PDF
 * viewer (every phone) has nothing to print there, and Safari's frame prints blank or the
 * page around it, so both are handed a tab of the PDF instead, printed from its viewer.
 */
function framePrints(): boolean {
	if ((navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled === false) return false;
	const ua = navigator.userAgent;
	return !(/AppleWebKit\//.test(ua) && !/(Chrome|Chromium)\//.test(ua));
}

/** The frame the last print loaded. A frame's print returns before its viewer is done
 *  with the PDF, so a frame stands until the next print replaces it. */
let frame: { el: HTMLIFrameElement; url: string } | undefined;

function blobOf(pdf: Uint8Array): string {
	// `BlobPart` takes an `ArrayBuffer`-backed view; wasm output is one.
	return URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
}

/**
 * Begin a print on the press itself. The tab a fallback prints from is opened here, while
 * the press still counts as one, since a tab opened after the render's await is a popup
 * the browser blocks.
 */
export function beginPrint(): Printing {
	const tab = framePrints() ? null : window.open('', '_blank');
	const viaTab = (pdf: Uint8Array): boolean => {
		const target = tab ?? window.open('', '_blank');
		if (!target) return false;
		// Not revoked: the tab's viewer can read the URL again for as long as it stands.
		target.location.href = blobOf(pdf);
		return true;
	};
	return {
		print(pdf) {
			if (!framePrints()) return viaTab(pdf);
			if (frame) {
				frame.el.remove();
				URL.revokeObjectURL(frame.url);
			}
			const url = blobOf(pdf);
			const el = document.createElement('iframe');
			el.setAttribute('aria-hidden', 'true');
			el.tabIndex = -1;
			// Laid out and off screen: a frame under `display: none` loads no viewer to print.
			el.style.cssText =
				'position:fixed;inset-inline-start:-10000px;top:0;width:1px;height:1px;border:0';
			el.addEventListener(
				'load',
				() => {
					try {
						el.contentWindow?.focus();
						el.contentWindow?.print();
					} catch {
						viaTab(pdf);
					}
				},
				{ once: true }
			);
			el.src = url;
			document.body.append(el);
			frame = { el, url };
			return true;
		},
		cancel() {
			tab?.close();
		}
	};
}
