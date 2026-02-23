import React, { useState, useEffect } from "react";
import { useEditorStore } from "../../state/editorStore";
import { FileImage, FileText, FileUp, Loader2, LockOpen, Pencil, Shield, Stamp, Trash2 } from "lucide-react";
import {
	applyWatermarkWithSettings,
	compressPdfDialogFlow,
	convertPdfToWordDialogFlow,
	deletePagesWithSelection,
	executeOrganizePages,
	getThumbnail,
	protectPdfWithSettings,
	selectImageForWatermark,
	unlockPdfWithPassword,
	selectFilesForMerge,
	executeMergePages,
	openDocumentDialog,
	type OpenDocResponse,
	type MergePageItem,
	type ProtectPdfPermissions,
	type WatermarkMode,
	type WatermarkPosition,
} from "../../api/commands";
import { invoke } from "@tauri-apps/api/core";
import logo from "../../assets/logo.png";
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	rectSortingStrategy,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReliablePdfDocument, PdfPagePreview } from "../pdf/SharedPdfRendering";
import {
	OrganizePanel,
	type OrganizePageItem,
} from "./organize/OrganizePanel";

// A locally unique ID wrapper for the sortable grid
interface SortablePageItem extends MergePageItem {
	id: string;
}

interface SortableMergeItemProps {
	item: SortablePageItem;
	onRemove: (id: string) => void;
}

export const SortableMergeItem: React.FC<SortableMergeItemProps> = React.memo(
	({ item, onRemove }) => {
		const {
			attributes,
			listeners,
			setNodeRef,
			transform,
			transition,
			isDragging,
		} = useSortable({ id: item.id });

		const style = {
			transform: CSS.Transform.toString(transform),
			transition,
			zIndex: isDragging ? 10 : 1,
		};

		return (
			<div
				ref={setNodeRef}
				style={style}
				className={`delete-page-card ${isDragging ? "dragging" : ""}`}
				{...attributes}
				{...listeners}
			>
				<div className="delete-page-preview-wrap">
					<ReliablePdfDocument fileId={item.path}>
						<PdfPagePreview
							pageNumber={item.pageNumber}
							width={160}
							className="merge-page-item-preview"
						/>
					</ReliablePdfDocument>
				</div>
				<button
					className="merge-item-remove-btn"
					onClick={(e) => {
						e.stopPropagation();
						onRemove(item.id);
					}}
				>
					<Trash2 size={14} /> Delete
				</button>
				<div className="merge-item-label">
					{(item.path.split(/[/\\]/).pop() || "doc").substring(0, 15)}{" "}
					(p.
					{item.pageNumber})
				</div>
			</div>
		);
	},
);

type HomeAction =
	| "edit"
	| "merge"
	| "compress"
	| "delete-pages"
	| "organize"
	| "protect"
	| "unlock"
	| "convert-word"
	| "watermark";

const ACTION_COPY: Record<
	HomeAction,
	{ title: string; description: string; cta: string }
> = {
	edit: {
		title: "Edit PDF",
		description:
			"Open a single PDF, edit annotations, and delete pages locally.",
		cta: "Start Editing",
	},
	merge: {
		title: "Merge PDF",
		description: "Combine multiple PDF files into one output document.",
		cta: "Start Merge",
	},
	compress: {
		title: "Compress PDF",
		description: "Reduce PDF size and save a compressed copy.",
		cta: "Start Compression",
	},
	"delete-pages": {
		title: "Delete Pages",
		description: "Remove selected pages from a PDF and save a new file.",
		cta: "Start Delete",
	},
	organize: {
		title: "Organize PDF",
		description: "Reorder or remove pages and export a reorganized PDF.",
		cta: "Start Organizing",
	},
	protect: {
		title: "Protect PDF",
		description: "Protect file with password and custom permissions.",
		cta: "Start Protecting",
	},
	unlock: {
		title: "Unlock PDF",
		description: "Remove restrictions and password from PDF files.",
		cta: "Start Unlocking",
	},
	"convert-word": {
		title: "Convert to Word",
		description: "Convert PDF into editable DOCX output.",
		cta: "Start Converting",
	},
	watermark: {
		title: "Watermark PDF",
		description: "Add text or image watermark to your PDF.",
		cta: "Start Watermarking",
	},
};

export const FileOpenPanel: React.FC = () => {
	const loadDoc = useEditorStore((state) => state.loadDoc);
	const pushToast = useEditorStore((state) => state.pushToast);
	const [isLoading, setIsLoading] = useState(false);
	const [selectedAction, setSelectedAction] = useState<HomeAction | null>(
		null,
	);
	const [statusMessage, setStatusMessage] = useState<string>("");
	void statusMessage;
	const [deleteDoc, setDeleteDoc] = useState<OpenDocResponse | null>(null);
	const [deleteThumbs, setDeleteThumbs] = useState<Record<number, string>>(
		{},
	);
	const [deletePages, setDeletePages] = useState<Set<number>>(new Set());
	const [pageInput, setPageInput] = useState("");
	const [mergeItems, setMergeItems] = useState<SortablePageItem[]>([]);
	const [organizeDoc, setOrganizeDoc] = useState<OpenDocResponse | null>(null);
	const [organizeItems, setOrganizeItems] = useState<OrganizePageItem[]>([]);
	const [protectDoc, setProtectDoc] = useState<OpenDocResponse | null>(null);
	const [userPassword, setUserPassword] = useState("");
	const [ownerPassword, setOwnerPassword] = useState("");
	const [unlockDoc, setUnlockDoc] = useState<OpenDocResponse | null>(null);
	const [unlockPassword, setUnlockPassword] = useState("");
	const [watermarkDoc, setWatermarkDoc] = useState<OpenDocResponse | null>(null);
	const [watermarkMode, setWatermarkMode] = useState<WatermarkMode>("text");
	const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
	const [watermarkImagePath, setWatermarkImagePath] = useState("");
	const [watermarkOpacity, setWatermarkOpacity] = useState(0.22);
	const [watermarkRotation, setWatermarkRotation] = useState(35);
	const [watermarkScalePercent, setWatermarkScalePercent] = useState(80);
	const [watermarkPosition, setWatermarkPosition] =
		useState<WatermarkPosition>("center");
	const [watermarkPageRange, setWatermarkPageRange] = useState("");
	const [protectPermissions, setProtectPermissions] =
		useState<ProtectPdfPermissions>({
			allowPrint: true,
			allowModify: false,
			allowExtract: false,
			allowAnnotate: false,
			allowForm: false,
			allowAssemble: false,
		});

	useEffect(() => {
		const onHome = () => {
			setSelectedAction(null);
			setMergeItems([]);
			setDeletePages(new Set());
			setDeleteDoc(null);
			setOrganizeDoc(null);
			setOrganizeItems([]);
			setProtectDoc(null);
			setUnlockDoc(null);
			setWatermarkDoc(null);
			setUserPassword("");
			setOwnerPassword("");
			setUnlockPassword("");
			setWatermarkText("CONFIDENTIAL");
			setWatermarkImagePath("");
			setWatermarkPageRange("");
			setWatermarkMode("text");
			setStatusMessage("");
			setPageInput("");
		};
		window.addEventListener("nav-home", onHome);
		return () => window.removeEventListener("nav-home", onHome);
	}, []);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleMergeDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (over && active.id !== over.id) {
			setMergeItems((items) => {
				const oldIndex = items.findIndex((i) => i.id === active.id);
				const newIndex = items.findIndex((i) => i.id === over.id);
				const newArray = [...items];
				const [moved] = newArray.splice(oldIndex, 1);
				newArray.splice(newIndex, 0, moved);
				return newArray;
			});
		}
	};

	const toErrorMessage = (error: unknown) => {
		if (error instanceof Error) return error.message;
		if (typeof error === "string") return error;
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	};

	const parsePageSelection = (input: string): number[] => {
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
					throw new Error("Invalid page range. Use values like 2-5.");
				}
				for (let p = a; p <= b; p++) values.add(p);
			} else {
				const page = Number.parseInt(token, 10);
				if (!Number.isFinite(page) || page < 1) {
					throw new Error(
						"Invalid page number. Use positive integers.",
					);
				}
				values.add(page);
			}
		}
		return Array.from(values).sort((a, b) => a - b);
	};

	const toastSuccess = (title: string, message: string) =>
		pushToast({ kind: "success", title, message, timeoutMs: 3000 });

	const toastError = (title: string, message: string) =>
		pushToast({ kind: "error", title, message, timeoutMs: 3000 });

	const toastWarning = (title: string, message: string) =>
		pushToast({ kind: "warning", title, message, timeoutMs: 3000 });

	const handleOpen = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			const res = await openDocumentDialog();
			if (res) {
				loadDoc(res.doc_id, res.page_count);
				toastSuccess("PDF Opened", `Loaded ${res.page_count} page(s).`);
			} else {
				setStatusMessage("No file selected.");
				toastWarning("Open Canceled", "No file selected.");
			}
		} catch (error) {
			console.error("Failed to open document:", error);
			setStatusMessage(`Open failed: ${toErrorMessage(error)}`);
			toastError("Open Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleMerge = async () => {
		if (mergeItems.length < 2 && mergeItems.length > 0) {
			setStatusMessage("Need at least 2 pages to merge.");
			toastError("Merge Failed", "Need at least 2 pages to merge.");
			return;
		}
		if (mergeItems.length === 0) {
			setIsLoading(true);
			try {
				const res = await selectFilesForMerge();
				if (res && res.length > 0) {
					const metas = await Promise.all(
						res.map(async (path) => {
							try {
								const docMeta = await invoke<OpenDocResponse>("doc_open", {
									path,
								});
								return { path, pageCount: docMeta.page_count };
							} catch (err) {
								console.error(`Failed to analyze ${path}:`, err);
								return null;
							}
						}),
					);

					const newItems: SortablePageItem[] = [];
					for (const item of metas) {
						if (!item) continue;
						for (let p = 1; p <= item.pageCount; p++) {
							newItems.push({
								id: `${item.path}-page-${p}-${crypto.randomUUID()}`,
								path: item.path,
								pageNumber: p,
							});
						}
					}

					setMergeItems(newItems);
					setStatusMessage(`Loaded ${newItems.length} pages for merge.`);
				} else {
					setStatusMessage("No files selected.");
					toastWarning("Merge Canceled", "No files selected.");
				}
			} catch (e) {
				setStatusMessage(`Error: ${toErrorMessage(e)}`);
				toastError("Merge Failed", toErrorMessage(e));
			} finally {
				setIsLoading(false);
			}
			return;
		}

		setIsLoading(true);
		setStatusMessage("Merging pages... this may take a moment.");
		try {
			// Extract just the parts executeMergePages needs
			const payload: MergePageItem[] = mergeItems.map((i) => ({
				path: i.path,
				pageNumber: i.pageNumber,
			}));

			const res = await executeMergePages(payload);
			if (res) {
				setStatusMessage(
					`Merged ${res.page_count} pages to ${res.output_path}`,
				);
				toastSuccess(
					"Merge Complete",
					`Merged ${res.page_count} page(s).`,
				);
				setMergeItems([]);
			} else {
				setStatusMessage("Merge canceled or failed.");
				toastWarning("Merge Canceled", "Merge canceled.");
			}
		} catch (error) {
			console.error("Failed to merge pages:", error);
			setStatusMessage(`Merge failed: ${toErrorMessage(error)}`);
			toastError("Merge Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleCompress = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			const res = await compressPdfDialogFlow();
			if (res) {
				setStatusMessage(
					`Compressed PDF: ${res.before_size} bytes -> ${res.after_size} bytes (${res.output_path})`,
				);
				toastSuccess(
					"Compression Complete",
					`Size reduced to ${res.after_size} bytes.`,
				);
			} else {
				setStatusMessage("Compression canceled or no file selected.");
				toastWarning("Compression Canceled", "No file selected.");
			}
		} catch (error) {
			console.error("Failed to compress PDF:", error);
			setStatusMessage(`Compression failed: ${toErrorMessage(error)}`);
			toastError("Compression Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleDeletePages = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			if (!deleteDoc) {
				const res = await openDocumentDialog();
				if (!res) {
					setStatusMessage("No file selected.");
					toastWarning("Delete Canceled", "No file selected.");
					return;
				}
				setDeleteDoc(res);
				setDeletePages(new Set());
				setDeleteThumbs({});

				const thumbs: Record<number, string> = {};
				await Promise.all(
					Array.from({ length: res.page_count }, (_, i) => i + 1).map(
						async (pageNum) => {
							try {
								thumbs[pageNum] = await getThumbnail(
									res.doc_id,
									pageNum - 1,
								);
							} catch {
								thumbs[pageNum] = "";
							}
						},
					),
				);
				setDeleteThumbs(thumbs);
				setStatusMessage("PDF loaded. Select pages to delete.");
				return;
			}

			const selected = Array.from(deletePages).sort((a, b) => a - b);
			if (selected.length === 0) {
				setStatusMessage("Select at least one page to delete.");
				toastError("Delete Pages Failed", "Select at least one page to delete.");
				return;
			}

			const res = await deletePagesWithSelection(
				deleteDoc.doc_id,
				selected,
			);
			if (!res) {
				setStatusMessage("Delete pages canceled.");
				toastWarning("Delete Canceled", "Delete pages canceled.");
				return;
			}
			setStatusMessage(
				`Deleted ${res.deleted_count} page(s). Remaining pages: ${res.remaining_pages}. Saved to ${res.output_path}`,
			);
			toastSuccess(
				"Delete Pages Complete",
				`Deleted ${res.deleted_count} page(s).`,
			);
			setDeleteDoc(null);
			setDeletePages(new Set());
			setDeleteThumbs({});
			setPageInput("");
		} catch (error) {
			console.error("Failed to delete pages:", error);
			setStatusMessage(`Delete pages failed: ${toErrorMessage(error)}`);
			toastError("Delete Pages Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const toggleDeletePage = (pageNum: number) => {
		setDeletePages((prev) => {
			const next = new Set(prev);
			if (next.has(pageNum)) next.delete(pageNum);
			else next.add(pageNum);
			return next;
		});
	};

	const applyPageInput = () => {
		try {
			const parsed = parsePageSelection(pageInput);
			setDeletePages(new Set(parsed));
			setStatusMessage(`Selected ${parsed.length} page(s) for deletion.`);
		} catch (error) {
			setStatusMessage(`Delete pages failed: ${toErrorMessage(error)}`);
			toastError("Delete Pages Failed", toErrorMessage(error));
		}
	};

	const handleOrganize = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			if (!organizeDoc) {
				const res = await openDocumentDialog();
				if (!res) {
					setStatusMessage("No file selected.");
					toastWarning("Organize Canceled", "No file selected.");
					return;
				}
				setOrganizeDoc(res);
				const items: OrganizePageItem[] = Array.from(
					{ length: res.page_count },
					(_, i) => ({
						id: `${res.doc_id}-page-${i + 1}-${Math.random().toString(36).slice(2, 8)}`,
						path: res.doc_id,
						pageNumber: i + 1,
					}),
				);
				setOrganizeItems(items);
				setStatusMessage(
					`Loaded ${items.length} pages for organize.`,
				);
				return;
			}

			if (organizeItems.length === 0) {
				setStatusMessage("Cannot export an empty PDF. Keep at least one page.");
				toastError(
					"Organize Failed",
					"Cannot export an empty PDF. Keep at least one page.",
				);
				return;
			}

			const res = await executeOrganizePages(
				organizeDoc.doc_id,
				organizeItems.map((i) => i.pageNumber),
			);
			if (!res) {
				setStatusMessage("Organize export canceled.");
				toastWarning("Organize Canceled", "Organize export canceled.");
				return;
			}
			setStatusMessage(
				`Organized PDF exported (${res.page_count} pages) to ${res.output_path}`,
			);
			toastSuccess(
				"Organize Complete",
				`Exported ${res.page_count} page(s).`,
			);
			setOrganizeDoc(null);
			setOrganizeItems([]);
		} catch (error) {
			setStatusMessage(`Organize failed: ${toErrorMessage(error)}`);
			toastError("Organize Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleProtect = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			if (!protectDoc) {
				const res = await openDocumentDialog();
				if (!res) {
					setStatusMessage("No file selected.");
					toastWarning("Protect Canceled", "No file selected.");
					return;
				}
				setProtectDoc(res);
				setStatusMessage("PDF selected. Configure password and permissions.");
				return;
			}

			if (userPassword.trim().length < 4) {
				setStatusMessage("Password must be at least 4 characters.");
				toastError("Protect Failed", "Password must be at least 4 characters.");
				return;
			}

			const res = await protectPdfWithSettings(
				protectDoc.doc_id,
				userPassword,
				ownerPassword,
				protectPermissions,
			);
			if (!res) {
				setStatusMessage("Protect canceled.");
				toastWarning("Protect Canceled", "Protect canceled.");
				return;
			}

			setStatusMessage(`Protected PDF saved to ${res.output_path}`);
			toastSuccess("Protect Complete", "Password protection applied.");
			setProtectDoc(null);
			setUserPassword("");
			setOwnerPassword("");
		} catch (error) {
			setStatusMessage(`Protect failed: ${toErrorMessage(error)}`);
			toastError("Protect Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleUnlock = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			if (!unlockDoc) {
				const res = await openDocumentDialog();
				if (!res) {
					setStatusMessage("No file selected.");
					toastWarning("Unlock Canceled", "No file selected.");
					return;
				}
				setUnlockDoc(res);
				setStatusMessage("PDF selected. Enter password to unlock.");
				return;
			}

			if (unlockPassword.trim().length === 0) {
				setStatusMessage("Password is required to unlock.");
				toastError("Unlock Failed", "Password is required to unlock.");
				return;
			}

			const res = await unlockPdfWithPassword(unlockDoc.doc_id, unlockPassword);
			if (!res) {
				setStatusMessage("Unlock canceled.");
				toastWarning("Unlock Canceled", "Unlock canceled.");
				return;
			}

			setStatusMessage(`Unlocked PDF saved to ${res.output_path}`);
			toastSuccess("Unlock Complete", "PDF restrictions removed.");
			setUnlockDoc(null);
			setUnlockPassword("");
		} catch (error) {
			setStatusMessage(`Unlock failed: ${toErrorMessage(error)}`);
			toastError("Unlock Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleConvertWord = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			const res = await convertPdfToWordDialogFlow();
			if (!res) {
				setStatusMessage("Conversion canceled.");
				toastWarning("Convert Canceled", "Conversion canceled.");
				return;
			}
			setStatusMessage(
				`Converted to Word via ${res.engine}. Saved to ${res.output_path}`,
			);
			toastSuccess(
				"Convert Complete",
				`Converted using ${res.engine}.`,
			);
		} catch (error) {
			setStatusMessage(`Convert failed: ${toErrorMessage(error)}`);
			toastError("Convert Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const handleWatermark = async () => {
		setIsLoading(true);
		setStatusMessage("");
		try {
			if (!watermarkDoc) {
				const res = await openDocumentDialog();
				if (!res) {
					setStatusMessage("No file selected.");
					toastWarning("Watermark Canceled", "No file selected.");
					return;
				}
				setWatermarkDoc(res);
				setStatusMessage("PDF selected. Configure watermark settings.");
				return;
			}

			if (watermarkMode === "text" && watermarkText.trim().length === 0) {
				setStatusMessage("Enter watermark text.");
				toastError("Watermark Failed", "Enter watermark text.");
				return;
			}
			if (watermarkMode === "image" && watermarkImagePath.trim().length === 0) {
				setStatusMessage("Select an image for watermark.");
				toastError("Watermark Failed", "Select an image for watermark.");
				return;
			}

			const res = await applyWatermarkWithSettings({
				inputPath: watermarkDoc.doc_id,
				mode: watermarkMode,
				text: watermarkMode === "text" ? watermarkText : undefined,
				imagePath:
					watermarkMode === "image" ? watermarkImagePath : undefined,
				opacity: watermarkOpacity,
				rotation: watermarkRotation,
				position: watermarkPosition,
				scalePercent: watermarkScalePercent,
				pageRange: watermarkPageRange.trim() || undefined,
			});
			if (!res) {
				setStatusMessage("Watermark canceled.");
				toastWarning("Watermark Canceled", "Watermark canceled.");
				return;
			}

			setStatusMessage(
				`Watermark applied to ${res.applied_pages} page(s). Saved to ${res.output_path}`,
			);
			toastSuccess(
				"Watermark Complete",
				`Applied watermark to ${res.applied_pages} page(s).`,
			);
			setWatermarkDoc(null);
		} catch (error) {
			setStatusMessage(`Watermark failed: ${toErrorMessage(error)}`);
			toastError("Watermark Failed", toErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	};

	const actionLabel =
		selectedAction === "merge"
			? mergeItems.length > 0
				? "Execute Merge"
				: "Select Files"
			: selectedAction === "convert-word"
				? "Convert PDF"
			: selectedAction === "watermark"
				? watermarkDoc
					? "Apply Watermark"
					: "Select PDF"
			: selectedAction === "unlock"
				? unlockDoc
					? "Unlock PDF"
					: "Select PDF"
			: selectedAction === "protect"
				? protectDoc
					? "Protect PDF"
					: "Select PDF"
			: selectedAction === "organize"
				? organizeDoc
					? "Export Organized PDF"
					: "Select PDF"
			: selectedAction === "delete-pages"
				? deleteDoc
					? "Apply Changes"
					: "Select PDF"
				: "Select File";

	const actionHandler =
		selectedAction === "merge"
			? handleMerge
			: selectedAction === "compress"
				? handleCompress
				: selectedAction === "convert-word"
					? handleConvertWord
				: selectedAction === "unlock"
					? handleUnlock
				: selectedAction === "protect"
					? handleProtect
				: selectedAction === "watermark"
					? handleWatermark
				: selectedAction === "organize"
					? handleOrganize
				: selectedAction === "delete-pages"
					? handleDeletePages
					: handleOpen;

	const showPrimaryActionButton = selectedAction !== "convert-word";

	return (
		<div className="open-panel-container">
			<div className="open-panel-box home-panel-bounded">
				<div className="home-header">
					<img src={logo} alt="lpdf logo" className="home-logo" />
					<h2>Edit PDF locally</h2>
					<p className="text-muted">
						Local only. Blazing fast. Secure.
					</p>
				</div>
				{!selectedAction ? (
					<>
						<section className="home-section-block">
							<h4 className="home-section-title">Most Popular</h4>
							<div className="home-actions-grid home-popular-grid">
								{(
									[
										"edit",
										"merge",
										"compress",
										"delete-pages",
										"organize",
										"convert-word",
									] as HomeAction[]
								).map((action) => (
									<div key={action} className="home-action-card">
										<div className="home-card-body">
											<h3>{ACTION_COPY[action].title}</h3>
											<p>{ACTION_COPY[action].description}</p>
										</div>
										<button
											className="btn-primary"
											onClick={() => setSelectedAction(action)}
										>
											{action === "edit" ? (
												<Pencil size={16} />
											) : (
												<FileUp size={16} />
											)}
											{ACTION_COPY[action].cta}
										</button>
									</div>
								))}
							</div>
						</section>

						<section className="home-section-block">
							<h4 className="home-section-title">Security</h4>
							<div className="home-actions-grid home-security-grid">
								{(["protect", "unlock", "watermark"] as HomeAction[]).map((action) => (
									<div key={action} className="home-action-card">
										<div className="home-card-body">
											<h3>{ACTION_COPY[action].title}</h3>
											<p>{ACTION_COPY[action].description}</p>
										</div>
										<button
											className="btn-primary"
											onClick={() => setSelectedAction(action)}
										>
											{action === "protect" ? (
												<Shield size={16} />
											) : action === "watermark" ? (
												<Stamp size={16} />
											) : (
												<LockOpen size={16} />
											)}
											{ACTION_COPY[action].cta}
										</button>
									</div>
								))}
							</div>
						</section>
					</>
				) : (
					<>
						<h3 className="home-selected-title">
							{ACTION_COPY[selectedAction].title}
						</h3>
						{showPrimaryActionButton ? (
							<button
								className="btn-primary home-primary-action-btn"
								onClick={actionHandler}
								disabled={isLoading}
							>
								{isLoading ? (
									<>
										<Loader2 size={16} className="spin" />{" "}
										Working...
									</>
								) : (
									<>
										<FileUp size={16} /> {actionLabel}
									</>
								)}
							</button>
						) : null}
						{selectedAction === "merge" ? (
							<div className="delete-pages-panel">
								{mergeItems.length > 0 ? (
									<DndContext
										sensors={sensors}
										collisionDetection={closestCenter}
										onDragEnd={handleMergeDragEnd}
									>
										<SortableContext
											items={mergeItems.map((i) => i.id)}
											strategy={rectSortingStrategy}
										>
											<div className="delete-pages-grid">
												{mergeItems.map((item) => (
													<SortableMergeItem
														key={item.id}
														item={item}
														onRemove={(id) =>
															setMergeItems((prev) =>
																prev.filter(
																	(f) =>
																		f.id !== id,
																),
															)
														}
													/>
												))}
											</div>
										</SortableContext>
									</DndContext>
								) : null}
								<div
									className="delete-pages-input-row merge-action-row"
									style={{ marginTop: 16 }}
								>
									<button
										className="btn-primary"
									onClick={async () => {
										const next =
											await selectFilesForMerge();
										if (next.length) {
											const metas = await Promise.all(
												next.map(async (path) => {
													try {
														const docMeta = await invoke<OpenDocResponse>(
															"doc_open",
															{ path },
														);
														return { path, pageCount: docMeta.page_count };
													} catch (err) {
														console.warn(
															"Skipping unreadable page count",
															err,
														);
														return null;
													}
												}),
											);
											const added: SortablePageItem[] = [];
											for (const item of metas) {
												if (!item) continue;
												for (let p = 1; p <= item.pageCount; p++) {
													added.push({
														id: `${item.path}-page-${p}-${crypto.randomUUID()}`,
														path: item.path,
														pageNumber: p,
													});
												}
											}
											if (added.length > 0) {
													setMergeItems((prev) => [
														...prev,
														...added,
													]);
												}
											}
										}}
									>
										Add More Files
									</button>
								</div>
							</div>
						) : null}
						{selectedAction === "delete-pages" && deleteDoc ? (
							<div className="delete-pages-panel">
								<p className="text-muted security-selected-file">
									Selected:{" "}
									{deleteDoc.doc_id.split("/").pop()} (
									{deleteDoc.page_count} pages)
								</p>
								<div className="delete-pages-grid">
									{Array.from(
										{ length: deleteDoc.page_count },
										(_, i) => i + 1,
									).map((pageNum) => (
										<div
											key={pageNum}
											className="delete-page-card"
										>
											<div className="delete-page-preview-wrap">
												{deleteThumbs[pageNum] ? (
													<img
														src={
															deleteThumbs[
																pageNum
															]
														}
														alt={`Page ${pageNum}`}
														className="delete-page-preview"
													/>
												) : (
													<div className="delete-page-fallback">
														Preview unavailable
													</div>
												)}
											</div>
											<button
												className={`delete-page-btn ${deletePages.has(pageNum) ? "selected" : ""}`}
												onClick={() =>
													toggleDeletePage(pageNum)
												}
											>
												<Trash2 size={14} />{" "}
												{deletePages.has(pageNum)
													? "Undo"
													: "Delete"}
											</button>
											<span className="delete-page-index">
												{pageNum}
											</span>
										</div>
									))}
								</div>
								<div className="delete-pages-input-row delete-action-row">
									<input
										type="text"
										className="page-interval-input"
										placeholder="1,3,5-8"
										value={pageInput}
										onChange={(e) =>
											setPageInput(e.target.value)
										}
									/>
									<button
										className="btn-primary"
										onClick={applyPageInput}
									>
										Apply Interval
									</button>
								</div>
							</div>
						) : null}
						{selectedAction === "protect" && protectDoc ? (
							<div className="delete-pages-panel security-form-panel">
								<p className="text-muted security-selected-file">
									Selected: {protectDoc.doc_id.split("/").pop()} ({protectDoc.page_count} pages)
								</p>
								<div className="delete-pages-input-row security-inputs-row">
									<div className="security-field">
										<label className="security-field-label" htmlFor="protect-user-password">
											User password
										</label>
										<input
											id="protect-user-password"
											type="password"
											className="page-interval-input"
											placeholder="Enter user password"
											value={userPassword}
											onChange={(e) => setUserPassword(e.target.value)}
										/>
										<span className="security-field-help">
											Required. Minimum 4 characters.
										</span>
									</div>
									<div className="security-field">
										<label className="security-field-label" htmlFor="protect-owner-password">
											Owner password (optional)
										</label>
										<input
											id="protect-owner-password"
											type="password"
											className="page-interval-input"
											placeholder="Enter owner password"
											value={ownerPassword}
											onChange={(e) => setOwnerPassword(e.target.value)}
										/>
										<span className="security-field-help">
											Optional. Leave empty to auto-generate.
										</span>
									</div>
								</div>
								<div className="protect-permissions-grid">
									{(
										[
											["allowPrint", "Allow print"],
											["allowModify", "Allow modify"],
											["allowExtract", "Allow copy/extract"],
											["allowAnnotate", "Allow annotate"],
											["allowForm", "Allow form fill"],
											["allowAssemble", "Allow page assembly"],
										] as Array<[keyof ProtectPdfPermissions, string]>
									).map(([key, label]) => (
										<label key={key} className="subbar-checkbox-label">
											<input
												type="checkbox"
												checked={protectPermissions[key]}
												onChange={(e) =>
													setProtectPermissions((prev) => ({
														...prev,
														[key]: e.target.checked,
													}))
												}
											/>
											{label}
										</label>
									))}
								</div>
							</div>
						) : null}
						{selectedAction === "unlock" && unlockDoc ? (
							<div className="delete-pages-panel security-form-panel">
								<p className="text-muted security-selected-file">
									Selected: {unlockDoc.doc_id.split("/").pop()} ({unlockDoc.page_count} pages)
								</p>
								<div className="delete-pages-input-row security-inputs-row">
									<div className="security-field">
										<label className="security-field-label" htmlFor="unlock-password">
											Current PDF password
										</label>
										<input
											id="unlock-password"
											type="password"
											className="page-interval-input"
											placeholder="Enter current password"
											value={unlockPassword}
											onChange={(e) => setUnlockPassword(e.target.value)}
										/>
										<span className="security-field-help">
											Use the existing password for this PDF.
										</span>
									</div>
								</div>
							</div>
						) : null}
						{selectedAction === "watermark" && watermarkDoc ? (
							<div className="delete-pages-panel security-form-panel security-large-panel">
								<p className="text-muted security-selected-file">
									Selected: {watermarkDoc.doc_id.split("/").pop()} ({watermarkDoc.page_count} pages)
								</p>
								<div className="delete-pages-input-row security-inputs-row">
									<div className="security-field">
										<label className="security-field-label" htmlFor="watermark-mode">
											Watermark type
										</label>
										<select
											id="watermark-mode"
											className="page-interval-input themed-select"
											value={watermarkMode}
											onChange={(e) =>
												setWatermarkMode(e.target.value as WatermarkMode)
											}
										>
											<option value="text">Text watermark</option>
											<option value="image">Image watermark</option>
										</select>
									</div>
									{watermarkMode === "text" ? (
										<div className="security-field">
											<label className="security-field-label" htmlFor="watermark-text">
												Watermark text
											</label>
											<input
												id="watermark-text"
												type="text"
												className="page-interval-input"
												placeholder="Enter watermark text"
												value={watermarkText}
												onChange={(e) => setWatermarkText(e.target.value)}
											/>
										</div>
									) : (
										<>
											<div className="security-field">
												<label className="security-field-label" htmlFor="watermark-image-path">
													Selected image
												</label>
												<input
													id="watermark-image-path"
													type="text"
													className="page-interval-input"
													placeholder="No image selected"
													value={watermarkImagePath}
													readOnly
												/>
											</div>
											<div className="security-field">
												<span className="security-field-label">Image action</span>
												<button
													className="btn-primary"
													onClick={async () => {
														const picked = await selectImageForWatermark();
														if (picked) setWatermarkImagePath(picked);
													}}
												>
													<FileImage size={16} /> Choose Image
												</button>
											</div>
										</>
									)}
								</div>
								<div className="delete-pages-input-row security-inputs-row">
									<div className="security-field">
										<label className="security-field-label" htmlFor="watermark-opacity">
											Opacity (0-1)
										</label>
										<input
											id="watermark-opacity"
											type="number"
											className="page-interval-input"
											placeholder="Opacity"
											value={watermarkOpacity}
											min={0.05}
											max={1}
											step={0.05}
											onChange={(e) =>
												setWatermarkOpacity(Number(e.target.value))
											}
										/>
									</div>
									<div className="security-field">
										<label className="security-field-label" htmlFor="watermark-rotation">
											Rotation (degrees)
										</label>
										<input
											id="watermark-rotation"
											type="number"
											className="page-interval-input"
											placeholder="Rotation"
											value={watermarkRotation}
											min={-180}
											max={180}
											onChange={(e) =>
												setWatermarkRotation(Number(e.target.value))
											}
										/>
									</div>
									<div className="security-field">
										<label className="security-field-label" htmlFor="watermark-scale">
											Scale (%)
										</label>
										<input
											id="watermark-scale"
											type="number"
											className="page-interval-input"
											placeholder="Scale"
											value={watermarkScalePercent}
											min={20}
											max={200}
											onChange={(e) =>
												setWatermarkScalePercent(Number(e.target.value))
											}
										/>
									</div>
									<div className="security-field">
										<label className="security-field-label" htmlFor="watermark-position">
											Position
										</label>
										<select
											id="watermark-position"
											className="page-interval-input themed-select"
											value={watermarkPosition}
											onChange={(e) =>
												setWatermarkPosition(e.target.value as WatermarkPosition)
											}
										>
											<option value="center">Center</option>
											<option value="top-left">Top left</option>
											<option value="top-right">Top right</option>
											<option value="bottom-left">Bottom left</option>
											<option value="bottom-right">Bottom right</option>
										</select>
									</div>
								</div>
								<div className="delete-pages-input-row security-inputs-row">
									<div className="security-field">
										<label className="security-field-label" htmlFor="watermark-page-range">
											Page range (optional)
										</label>
										<input
											id="watermark-page-range"
											type="text"
											className="page-interval-input"
											placeholder="e.g. 1,3,5-8"
											value={watermarkPageRange}
											onChange={(e) => setWatermarkPageRange(e.target.value)}
										/>
									</div>
								</div>
							</div>
						) : null}
						{selectedAction === "convert-word" ? (
							<div className="delete-pages-panel security-form-panel">
								<div className="delete-pages-input-row security-inputs-row">
									<button className="btn-primary" onClick={handleConvertWord}>
										<FileText size={16} /> Convert PDF to Word
									</button>
								</div>
							</div>
						) : null}
						{selectedAction === "organize" && organizeDoc ? (
							<OrganizePanel
								items={organizeItems}
								onItemsChange={setOrganizeItems}
								onRemoveItem={(id) =>
									setOrganizeItems((prev) =>
										prev.filter((p) => p.id !== id),
									)
								}
							/>
						) : null}
					</>
				)}
				{null}
			</div>
		</div>
	);
};
