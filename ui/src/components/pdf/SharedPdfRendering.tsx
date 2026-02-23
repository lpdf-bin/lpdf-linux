import React, { useEffect, useState, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { readPdfBytes } from "../../api/commands";

const PDF_BYTE_CACHE_MAX = 12;
const pdfByteCache = new Map<string, Uint8Array>();

export function invalidatePdfBytesCache(fileId: string): void {
	pdfByteCache.delete(fileId);
}

export function invalidateAllPdfBytesCache(): void {
	pdfByteCache.clear();
}

function getCachedPdfBytes(fileId: string): Uint8Array | null {
	const cached = pdfByteCache.get(fileId);
	if (!cached) return null;
	pdfByteCache.delete(fileId);
	pdfByteCache.set(fileId, cached);
	return cached;
}

function setCachedPdfBytes(fileId: string, data: Uint8Array): void {
	if (pdfByteCache.has(fileId)) {
		pdfByteCache.delete(fileId);
	}
	pdfByteCache.set(fileId, data);
	if (pdfByteCache.size > PDF_BYTE_CACHE_MAX) {
		const oldest = pdfByteCache.keys().next().value as string | undefined;
		if (oldest) pdfByteCache.delete(oldest);
	}
}

// Setup Worker globally here so everyone importing this module gets it.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url,
).toString();

interface ReliablePdfDocumentProps {
	/** Absolute path to the local PDF file */
	fileId?: string | null;
	refreshToken?: number;
	children: React.ReactNode;
	loading?: React.ReactNode;
	error?: React.ReactNode;
}

/**
 * reliable-pdf-document
 *
 * Intercepts the PDF path, uses Tauri's IPC `readPdfBytes` to fetch the raw buffer,
 * and passes the Uint8Array to pdfjs. This radically avoids all `asset://` schema
 * CORS and ServiceWorker fetching bugs in tauri/react-pdf environments.
 */
export const ReliablePdfDocument: React.FC<ReliablePdfDocumentProps> = ({
	fileId,
	refreshToken = 0,
	children,
	loading = (
		<div className="pdf-page-placeholder-text">Loading document...</div>
	),
	error = <div className="pdf-page-placeholder-text">Error loading PDF.</div>,
}) => {
	const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
	const [fetchError, setFetchError] = useState<Error | null>(null);

	useEffect(() => {
		if (!fileId) {
			setPdfData(null);
			setFetchError(null);
			return;
		}

		const cached = getCachedPdfBytes(fileId);
		if (cached) {
			setPdfData(cached);
			setFetchError(null);
			return;
		}

		let isMounted = true;
		readPdfBytes(fileId)
			.then((bytes) => {
				if (isMounted) {
					setCachedPdfBytes(fileId, bytes);
					setPdfData(bytes);
					setFetchError(null);
				}
			})
			.catch((err) => {
				console.error("Failed to read PDF bytes:", err);
				if (isMounted)
					setFetchError(
						err instanceof Error ? err : new Error(String(err)),
					);
			});

		return () => {
			isMounted = false;
		};
	}, [fileId, refreshToken]);

	// react-pdf requires the `file` prop object reference to be stable
	// or it will constantly unmount/remount the document.
	const fileObj = useMemo(() => {
		if (!pdfData) return null;
		return { data: pdfData };
	}, [pdfData]);

	if (fetchError) {
		return <>{error}</>;
	}

	if (!fileObj) {
		return <>{loading}</>;
	}

	return (
		<Document file={fileObj} loading={loading} error={error}>
			{children}
		</Document>
	);
};

interface PdfPagePreviewProps {
	pageNumber: number;
	width: number;
	className?: string;
	renderTextLayer?: boolean;
	renderAnnotationLayer?: boolean;
	devicePixelRatio?: number;
}

/**
 * Standardized Page wrapper that enforces uniform loading/error states.
 */
export const PdfPagePreview: React.FC<PdfPagePreviewProps> = ({
	pageNumber,
	width,
	className,
	renderTextLayer = false,
	renderAnnotationLayer = false,
	devicePixelRatio,
}) => {
	return (
		<Page
			pageNumber={pageNumber}
			width={width}
			renderTextLayer={renderTextLayer}
			renderAnnotationLayer={renderAnnotationLayer}
			className={className}
			devicePixelRatio={devicePixelRatio}
			loading={
				<div className="pdf-page-placeholder-text">
					<span className="mock-render-text">Loading...</span>
				</div>
			}
			error={
				<div className="pdf-page-placeholder-text">
					<span className="mock-render-text">Error</span>
				</div>
			}
		/>
	);
};
