import React, { useState, useEffect, useCallback } from "react";
import { useEditorStore } from "../../state/editorStore";
import { saveDocument, openDocumentDialog } from "../../api/commands";
import { invalidatePdfBytesCache } from "../pdf/SharedPdfRendering";
import {
	FolderOpen,
	Save,
	Settings,
	Undo,
	Redo,
	ZoomIn,
	ZoomOut,
	Maximize,
	Loader2,
	Moon,
	Sun,
	MousePointer2,
	Hand,
	Type,
	Link as LinkIcon,
	SquareMenu,
	Eraser,
	Trash2,
} from "lucide-react";
import logo from "../../assets/logo.png";

const PAGE_WIDTH = 612; // Canvas page width for fit-width calc

export const TopToolbar: React.FC = () => {
	const {
		isDocLoaded,
		docId,
		pages,
		zoomLevel,
		setZoom,
		theme,
		toggleTheme,
		openSettings,
		undo,
		redo,
		past,
		future,
		activeTool,
		setTool,
		loadDoc,
		closeDoc,
		deleteActivePage,
		pushToast,
		bumpPdfContentVersion,
	} = useEditorStore();

	const [isSaving, setIsSaving] = useState(false);

	const handleOpen = useCallback(async () => {
		try {
			const res = await openDocumentDialog();
			if (res) {
				loadDoc(res.doc_id, res.page_count);
				pushToast({
					kind: "success",
					title: "PDF Opened",
					message: `Loaded ${res.page_count} page(s).`,
					timeoutMs: 3000,
				});
			} else {
				pushToast({
					kind: "warning",
					title: "Open Canceled",
					message: "No file selected.",
					timeoutMs: 3000,
				});
			}
		} catch (error) {
			console.error("Failed to open file:", error);
			pushToast({
				kind: "error",
				title: "Open Failed",
				message: error instanceof Error ? error.message : String(error),
				timeoutMs: 3000,
			});
		}
	}, [loadDoc, pushToast]);

	const handleSave = useCallback(async () => {
		if (!docId || isSaving) return;
		setIsSaving(true);
		try {
			const result = await saveDocument(docId, pages);
			if (result.ok) {
				invalidatePdfBytesCache(docId);
				bumpPdfContentVersion();
				pushToast({
					kind: "success",
					title: "Save Complete",
					message: "Document saved successfully.",
					timeoutMs: 3000,
				});
				if (result.repairApplied && result.repairWarning) {
					pushToast({
						kind: "warning",
						title: "Save Repaired",
						message: result.repairWarning,
						timeoutMs: 3000,
					});
				}
				if (result.backupWarning) {
					pushToast({
						kind: "warning",
						title: "Backup Warning",
						message: result.backupWarning,
						timeoutMs: 3000,
					});
				}
			} else {
				pushToast({
					kind: "error",
					title: "Save Failed",
					message: result.error,
					timeoutMs: 3000,
				});
			}
		} catch (error) {
			pushToast({
				kind: "error",
				title: "Save Failed",
				message: error instanceof Error ? error.message : String(error),
				timeoutMs: 3000,
			});
		} finally {
			setIsSaving(false);
		}
	}, [docId, isSaving, pages, pushToast, bumpPdfContentVersion]);

	const handleDeletePage = useCallback(() => {
		const deleted = deleteActivePage();
		if (deleted) {
			pushToast({
				kind: "success",
				title: "Page Deleted",
				message: "Active page removed.",
				timeoutMs: 3000,
			});
		}
	}, [deleteActivePage, pushToast]);

	// Step 8: Fit Width — compute zoom so page fills canvas width
	const handleFitWidth = useCallback(() => {
		const canvas = document.querySelector(".editor-canvas");
		if (!canvas) return;
		const canvasWidth = canvas.clientWidth - 64; // padding
		const fitZoom = canvasWidth / PAGE_WIDTH;
		setZoom(Math.min(Math.max(0.1, fitZoom), 5.0));
	}, [setZoom]);

	const handleGoHome = useCallback(() => {
		closeDoc();
		window.dispatchEvent(new CustomEvent("nav-home"));
	}, [closeDoc]);

	// Step 7: Global Ctrl shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Skip if in input fields
			const tag = (e.target as HTMLElement).tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
				return;

			if (e.ctrlKey || e.metaKey) {
				switch (e.key.toLowerCase()) {
					case "o":
						e.preventDefault();
						handleOpen();
						break;
					case "s":
						e.preventDefault();
						handleSave();
						break;
					case "z":
						e.preventDefault();
						if (e.shiftKey) {
							redo();
						} else {
							undo();
						}
						break;
					case "y":
						e.preventDefault();
						redo();
						break;
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleOpen, handleSave, undo, redo]);

	return (
		<header className="top-toolbar">
			<div className="toolbar-group">
				<button
					type="button"
					className="brand-mark"
					title="Go to Home"
					onClick={handleGoHome}
				>
					<img src={logo} alt="lpdf logo" className="brand-logo" />
					<span className="brand-text">lpdf</span>
				</button>
				<div className="divider-vertical" />
				<button
					className="icon-btn"
					title="Open PDF (Ctrl+O)"
					onClick={handleOpen}
				>
					<FolderOpen size={18} />
				</button>
				{isDocLoaded && (
					<button
						className="icon-btn primary"
						title="Save (Ctrl+S)"
						onClick={handleSave}
						disabled={isSaving}
					>
						{isSaving ? (
							<Loader2 size={18} className="spin" />
						) : (
							<Save size={18} />
						)}
					</button>
				)}
				{isDocLoaded && (
					<button
						className="icon-btn"
						title="Delete Active Page"
						onClick={handleDeletePage}
						disabled={pages.length <= 1}
					>
						<Trash2 size={18} />
					</button>
				)}
			</div>

			<div
				className="toolbar-group center"
				style={{ flex: 1, justifyContent: "center" }}
			>
				{isDocLoaded && (
					<>
						<button
							className={`icon-btn ${activeTool === "select" ? "active" : ""}`}
							onClick={() => setTool("select")}
							title="Select Tool (V)"
						>
							<MousePointer2 size={18} />
						</button>
						<button
							className={`icon-btn ${activeTool === "pan" ? "active" : ""}`}
							onClick={() => setTool("pan")}
							title="Pan Tool (H)"
						>
							<Hand size={18} />
						</button>
						<button
							className={`icon-btn ${activeTool === "text" ? "active" : ""}`}
							onClick={() => setTool("text")}
							title="Text Tool (T)"
						>
							<Type size={18} />
						</button>
						<button
							className={`icon-btn ${activeTool === "link" ? "active" : ""}`}
							onClick={() => setTool("link")}
							title="Link Tool (L)"
						>
							<LinkIcon size={18} />
						</button>
						<button
							className={`icon-btn ${activeTool === "form-text" ? "active" : ""}`}
							onClick={() => setTool("form-text")}
							title="Form Tool (F)"
						>
							<SquareMenu size={18} />
						</button>
						<button
							className={`icon-btn ${activeTool === "whiteout" ? "active" : ""}`}
							onClick={() => setTool("whiteout")}
							title="Whiteout (W)"
						>
							<Eraser size={18} />
						</button>
					</>
				)}
			</div>

			<div className="toolbar-group right">
				{isDocLoaded && (
					<>
						<button
							className="icon-btn"
							title="Undo (Ctrl+Z)"
							onClick={undo}
							disabled={past.length === 0}
							style={{ opacity: past.length === 0 ? 0.3 : 1 }}
						>
							<Undo size={18} />
						</button>
						<button
							className="icon-btn"
							title="Redo (Ctrl+Y)"
							onClick={redo}
							disabled={future.length === 0}
							style={{
								opacity: future.length === 0 ? 0.3 : 1,
							}}
						>
							<Redo size={18} />
						</button>
						<div className="divider-vertical" />
						<button
							className="icon-btn"
							title="Zoom Out"
							onClick={() =>
								setZoom(Math.max(0.1, zoomLevel - 0.1))
							}
						>
							<ZoomOut size={18} />
						</button>
						<span className="zoom-text">
							{Math.round(zoomLevel * 100)}%
						</span>
						<button
							className="icon-btn"
							title="Zoom In"
							onClick={() =>
								setZoom(Math.min(5.0, zoomLevel + 0.1))
							}
						>
							<ZoomIn size={18} />
						</button>
						<button
							className="icon-btn"
							title="Fit Width"
							onClick={handleFitWidth}
						>
							<Maximize size={18} />
						</button>
					</>
				)}
				<div className="divider-vertical" />
				<button
					className="icon-btn"
					title="Toggle Theme"
					onClick={toggleTheme}
				>
					{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
				</button>
				<button
					className="icon-btn"
					title="Settings"
					onClick={openSettings}
				>
					<Settings size={18} />
				</button>
			</div>
		</header>
	);
};
