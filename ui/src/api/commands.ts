import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/** Maximum supported file size in bytes (50 MB) */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function normalizeDialogPath(path: string): string {
	if (path.startsWith("file://")) {
		try {
			return decodeURIComponent(new URL(path).pathname);
		} catch {
			return path.replace("file://", "");
		}
	}
	return path;
}

export interface OpenDocResponse {
	doc_id: string;
	page_count: number;
	file_size: number;
}

export interface ThumbnailResponse {
	base64_image: string;
}

export interface MergePdfResponse {
	output_path: string;
	input_count: number;
	page_count: number;
}

export interface MergePageItem {
	path: string;
	pageNumber: number; // camelCase in TS, maps to page_number in Rust by rename_all="camelCase"
}

export interface CompressPdfResponse {
	output_path: string;
	before_size: number;
	after_size: number;
}

export interface DeletePagesResponse {
	output_path: string;
	deleted_count: number;
	remaining_pages: number;
}

export interface ProtectPdfPermissions {
	allowPrint: boolean;
	allowModify: boolean;
	allowExtract: boolean;
	allowAnnotate: boolean;
	allowForm: boolean;
	allowAssemble: boolean;
}

export interface ProtectPdfResponse {
	output_path: string;
	protected: boolean;
}

export interface ConvertPdfToWordResponse {
	output_path: string;
	engine: string;
}

export type WatermarkMode = "text" | "image";

export type WatermarkPosition =
	| "center"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export interface WatermarkSettings {
	inputPath: string;
	mode: WatermarkMode;
	text?: string;
	imagePath?: string;
	opacity: number;
	rotation: number;
	position: WatermarkPosition;
	scalePercent: number;
	pageRange?: string;
}

export interface WatermarkPdfResponse {
	output_path: string;
	applied_pages: number;
}

export async function openDocumentDialog(): Promise<OpenDocResponse | null> {
	const selectedPath = await open({
		multiple: false,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (!selectedPath) return null;
	if (Array.isArray(selectedPath)) return null;
	const normalized = normalizeDialogPath(selectedPath);
	const res = await invoke<OpenDocResponse>("doc_open", {
		path: normalized,
	});
	return res;
}

// Step 10: getThumbnail IPC wrapper
export async function getThumbnail(
	docId: string,
	pageIndex: number,
	width: number = 300,
): Promise<string> {
	const res = await invoke<ThumbnailResponse>("doc_get_thumbnail", {
		path: docId,
		pageIndex,
		width,
	});
	return res.base64_image;
}

export interface SaveResponse {
	saved_path: string;
	annotation_count: number;
	backup_warning?: string;
	repair_applied?: boolean;
	repair_warning?: string;
}

export type SaveDocumentResult =
	| {
			ok: true;
			savedPath: string;
			annotationCount: number;
			backupWarning?: string;
			repairApplied?: boolean;
			repairWarning?: string;
	  }
	| { ok: false; error: string };

export async function saveDocument(
	docId: string,
	operations: unknown,
): Promise<SaveDocumentResult> {
	try {
		const pageStates = Array.isArray(operations)
			? (operations as Array<{
					number?: number;
					rotation?: number;
					annotations?: Array<{
						type?: string;
						text?: string;
						x?: number;
						y?: number;
						width?: number;
						height?: number;
						fontSize?: number;
					}>;
			  }>).map((page, idx) => ({
					pageNumber: page.number || idx + 1,
					rotation: page.rotation || 0,
					annotations: (page.annotations || []).map((ann) => ({
						type: ann.type,
						text: ann.text,
						x: ann.x,
						y: ann.y,
						width: ann.width,
						height: ann.height,
						fontSize: ann.fontSize,
					})),
			  }))
			: [];
		const res = await invoke<SaveResponse>("doc_save", {
			path: docId,
			pageStates,
		});
		return {
			ok: true,
			savedPath: res.saved_path,
			annotationCount: res.annotation_count,
			backupWarning: res.backup_warning,
			repairApplied: res.repair_applied,
			repairWarning: res.repair_warning,
		};
	} catch (error) {
		console.error("Save failed:", error);
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function selectFilesForMerge(): Promise<string[]> {
	const selected = await open({
		multiple: true,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (!selected || !Array.isArray(selected) || selected.length === 0) {
		return [];
	}
	return selected.map(normalizeDialogPath);
}

export async function executeMerge(
	inputPaths: string[],
): Promise<MergePdfResponse | null> {
	if (inputPaths.length < 2) return null;
	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "merged.pdf",
	});
	if (!outputPath) return null;
	const normalizedOutput = normalizeDialogPath(outputPath);

	return invoke<MergePdfResponse>("doc_merge", {
		inputPaths,
		outputPath: normalizedOutput,
	});
}

/**
 * Executes a page-level merge with specific page sequences
 */
export async function executeMergePages(
	inputPages: MergePageItem[],
): Promise<MergePdfResponse | null> {
	if (inputPages.length === 0) return null;
	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "merged.pdf",
	});
	if (!outputPath) return null;
	const normalizedOutput = normalizeDialogPath(outputPath);

	return invoke<MergePdfResponse>("doc_merge_pages", {
		inputPages,
		outputPath: normalizedOutput,
	});
}

export async function executeOrganizePages(
	inputPath: string,
	orderedPageNumbers: number[],
): Promise<MergePdfResponse | null> {
	if (orderedPageNumbers.length === 0) return null;
	const payload: MergePageItem[] = orderedPageNumbers.map((pageNumber) => ({
		path: inputPath,
		pageNumber,
	}));
	return executeMergePages(payload);
}

/**
 * Reliable raw byte loading for react-pdf to avoid asset:// CORS fails
 */
export async function readPdfBytes(path: string): Promise<Uint8Array> {
	return invoke<Uint8Array>("doc_read_bytes", { path });
}

export async function compressPdfDialogFlow(): Promise<CompressPdfResponse | null> {
	const selected = await open({
		multiple: false,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (!selected || Array.isArray(selected)) {
		return null;
	}
	const inputPath = normalizeDialogPath(selected);

	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "compressed.pdf",
	});
	if (!outputPath) return null;
	const normalizedOutput = normalizeDialogPath(outputPath);

	return invoke<CompressPdfResponse>("doc_compress", {
		inputPath,
		outputPath: normalizedOutput,
	});
}

function parsePageSelection(input: string): number[] {
	const values = new Set<number>();
	for (const token of input
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)) {
		if (token.includes("-")) {
			const [a, b] = token
				.split("-")
				.map((n) => Number.parseInt(n.trim(), 10));
			if (
				!Number.isFinite(a) ||
				!Number.isFinite(b) ||
				a < 1 ||
				b < 1 ||
				b < a
			) {
				throw new Error("Invalid page range. Use formats like 2-5.");
			}
			for (let p = a; p <= b; p++) values.add(p);
		} else {
			const page = Number.parseInt(token, 10);
			if (!Number.isFinite(page) || page < 1) {
				throw new Error("Invalid page number. Use positive integers.");
			}
			values.add(page);
		}
	}

	if (values.size === 0) {
		throw new Error("No valid pages selected.");
	}

	return Array.from(values).sort((a, b) => a - b);
}

export async function deletePagesDialogFlow(): Promise<DeletePagesResponse | null> {
	const selected = await open({
		multiple: false,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (!selected || Array.isArray(selected)) {
		return null;
	}

	const pageInput = window.prompt(
		"Enter pages to delete (e.g. 1,3,5-8):",
		"1",
	);
	if (!pageInput) {
		return null;
	}
	const pages = parsePageSelection(pageInput);

	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "deleted-pages.pdf",
	});
	if (!outputPath) return null;

	return invoke<DeletePagesResponse>("doc_delete_pages", {
		inputPath: normalizeDialogPath(selected),
		pageNumbers: pages,
		outputPath: normalizeDialogPath(outputPath),
	});
}

export async function deletePagesWithSelection(
	inputPath: string,
	pageNumbers: number[],
): Promise<DeletePagesResponse | null> {
	if (pageNumbers.length === 0) return null;
	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "deleted-pages.pdf",
	});
	if (!outputPath) return null;

	return invoke<DeletePagesResponse>("doc_delete_pages", {
		inputPath: normalizeDialogPath(inputPath),
		pageNumbers,
		outputPath: normalizeDialogPath(outputPath),
	});
}

export async function protectPdfWithSettings(
	inputPath: string,
	userPassword: string,
	ownerPassword: string,
	permissions: ProtectPdfPermissions,
): Promise<ProtectPdfResponse | null> {
	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "protected.pdf",
	});
	if (!outputPath) return null;

	return invoke<ProtectPdfResponse>("doc_protect_pdf", {
		inputPath: normalizeDialogPath(inputPath),
		outputPath: normalizeDialogPath(outputPath),
		userPassword,
		ownerPassword,
		permissions,
	});
}

export async function unlockPdfWithPassword(
	inputPath: string,
	password: string,
): Promise<ProtectPdfResponse | null> {
	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "unlocked.pdf",
	});
	if (!outputPath) return null;

	return invoke<ProtectPdfResponse>("doc_unlock_pdf", {
		inputPath: normalizeDialogPath(inputPath),
		outputPath: normalizeDialogPath(outputPath),
		password,
	});
}

export async function convertPdfToWordDialogFlow(): Promise<ConvertPdfToWordResponse | null> {
	const selected = await open({
		multiple: false,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (!selected || Array.isArray(selected)) {
		return null;
	}

	const outputPath = await save({
		filters: [{ name: "Word", extensions: ["docx"] }],
		defaultPath: "converted.docx",
	});
	if (!outputPath) return null;

	return invoke<ConvertPdfToWordResponse>("doc_convert_pdf_to_word", {
		inputPath: normalizeDialogPath(selected),
		outputPath: normalizeDialogPath(outputPath),
	});
}

export async function selectImageForWatermark(): Promise<string | null> {
	const selected = await open({
		multiple: false,
		filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
	});
	if (!selected || Array.isArray(selected)) return null;
	return normalizeDialogPath(selected);
}

export async function applyWatermarkWithSettings(
	settings: WatermarkSettings,
): Promise<WatermarkPdfResponse | null> {
	const outputPath = await save({
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		defaultPath: "watermarked.pdf",
	});
	if (!outputPath) return null;

	return invoke<WatermarkPdfResponse>("doc_watermark_pdf", {
		inputPath: normalizeDialogPath(settings.inputPath),
		outputPath: normalizeDialogPath(outputPath),
		mode: settings.mode,
		text: settings.text,
		imagePath: settings.imagePath,
		opacity: settings.opacity,
		rotation: settings.rotation,
		position: settings.position,
		scalePercent: settings.scalePercent,
		pageRange: settings.pageRange,
	});
}
