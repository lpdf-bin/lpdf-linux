import React, {
	useState,
	useEffect,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { useEditorStore } from "../../state/editorStore";
import type { AnnotationType, PageAnnotation } from "../../state/editorStore";
import { ReliablePdfDocument, PdfPagePreview } from "../pdf/SharedPdfRendering";
import { ask } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_WIDTH = 612; // 8.5in at 72dpi
const PAGE_HEIGHT = 792; // 11in at 72dpi
const MIN_DRAG_THRESHOLD = 3; // px before committing a drag move

/* ------------------------------------------------------------------ */
/* Memoized Annotation Node                                           */
/* ------------------------------------------------------------------ */

interface AnnotationNodeProps {
	ann: PageAnnotation;
	isSelected: boolean;
	activeTool: string;
	onSelect: (e: React.MouseEvent, id: string) => void;
	onDragStart: (e: React.PointerEvent, ann: PageAnnotation) => void;
	onDragMove: (e: React.PointerEvent) => void;
	onDragEnd: (e: React.PointerEvent) => void;
	onResizeStart: (e: React.PointerEvent, ann: PageAnnotation) => void;
	onResizeMove: (e: React.PointerEvent) => void;
	onResizeEnd: (e: React.PointerEvent) => void;
}

const AnnotationNode = React.memo<AnnotationNodeProps>(
	({
		ann,
		isSelected,
		activeTool,
		onSelect,
		onDragStart,
		onDragMove,
		onDragEnd,
		onResizeStart,
		onResizeMove,
		onResizeEnd,
	}) => {
		const isText = ann.type === "text";
		const isLink = ann.type === "link";
		const isWhiteout = ann.type === "whiteout";

		let borderStyle = isSelected
			? "2px dashed var(--accent-primary)"
			: "2px solid transparent";
		let backgroundStyle = "transparent";

		if (!isText && !isSelected) {
			borderStyle = isLink
				? "2px solid rgba(139, 233, 253, 0.5)"
				: isWhiteout
					? "1px solid #ff5555"
					: "2px solid rgba(241, 250, 140, 0.5)";
		}

		if (isWhiteout) backgroundStyle = "#ffffff";
		else if (isLink) backgroundStyle = "rgba(139, 233, 253, 0.1)";
		else if (!isText) backgroundStyle = "rgba(241, 250, 140, 0.1)";

		if (isWhiteout && !isSelected) {
			borderStyle = ann.borderEnabled
				? `1px solid ${ann.borderColor || "#ff5555"}`
				: "1px solid transparent";
		}

		const nodeStyle: React.CSSProperties = {
			position: "absolute",
			left: ann.x,
			top: ann.y,
			width: ann.width || "auto",
			height: ann.height || "auto",
			color: isText
				? ann.color || "#000000"
				: isLink
					? "#8be9fd"
					: "var(--bg-elevated)",
			fontFamily: isText ? ann.fontFamily || "Inter" : "inherit",
			fontSize: isText ? ann.fontSize || 14 : isLink ? 10 : 14,
			fontWeight: isText ? "bold" : "normal",
			pointerEvents: "auto",
			whiteSpace: "nowrap",
			border: borderStyle,
			backgroundColor: backgroundStyle,
			cursor:
				activeTool === "select"
					? isSelected
						? "move"
						: "pointer"
					: "default",
			padding: isText ? "2px 4px" : "4px",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			overflow: "hidden",
			userSelect: "none",
			/* GPU layer only on actively dragged nodes */
			willChange: isSelected ? "transform" : "auto",
		};

		return (
			<div
				style={nodeStyle}
				onClick={(e) => onSelect(e, ann.id)}
				onPointerDown={(e) => {
					if (activeTool === "select") {
						onDragStart(e, ann);
					}
				}}
				onPointerMove={onDragMove}
				onPointerUp={onDragEnd}
			>
				{ann.text}
				{isSelected && (isText || isWhiteout) && (
					<div
						className="resize-handle br"
						onPointerDown={(e) => onResizeStart(e, ann)}
						onPointerMove={onResizeMove}
						onPointerUp={onResizeEnd}
						title="Resize"
					/>
				)}
			</div>
		);
	},
);

/* ------------------------------------------------------------------ */
/* Editor Canvas                                                      */
/* ------------------------------------------------------------------ */

export const EditorCanvas: React.FC = () => {
	const {
		activePageId,
		pages,
		zoomLevel,
		setZoom,
		addAnnotation,
		moveAnnotation,
		resizeAnnotation,
		saveHistory,
		activeTool,
		panOffset,
		setPanOffset,
		selectedNodeIds,
		setSelectedNodes,
		setTool,
		textColor,
		textFontFamily,
		textFontSize,
		docId,
		pdfContentVersion,
	} = useEditorStore();

	const [inputText, setInputText] = useState("");
	const [inputPos, setInputPos] = useState<{ x: number; y: number } | null>(
		null,
	);

	// Panning state
	const [isPanning, setIsPanning] = useState(false);
	const [isSpaceDown, setIsSpaceDown] = useState(false);

	// Drag to draw box state (for link/form/whiteout regions)
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [dragCurrent, setDragCurrent] = useState<{
		x: number;
		y: number;
	} | null>(null);

	// Annotation drag state — useRef avoids re-renders during drag
	const dragRef = useRef<{
		annId: string;
		startX: number;
		startY: number;
		origX: number;
		origY: number;
		annWidth: number;
		annHeight: number;
		pageRect: DOMRect;
		zoomAtStart: number;
		historySaved: boolean;
		hasMoved: boolean;
	} | null>(null);

	const resizeRef = useRef<{
		annId: string;
		startX: number;
		startY: number;
		origW: number;
		origH: number;
		pageRect: DOMRect;
		zoomAtStart: number;
		annType: AnnotationType;
		historySaved: boolean;
	} | null>(null);

	// Refs for latest values to avoid stale closures
	const panOffsetRef = useRef(panOffset);
	const zoomRef = useRef(zoomLevel);

	useEffect(() => {
		panOffsetRef.current = panOffset;
		zoomRef.current = zoomLevel;
	}, [panOffset, zoomLevel]);

	const activePage = pages.find((p) => p.id === activePageId);

	// B2: RAF throttle ref for drag/resize — write to ref, flush once per frame
	const rafRef = useRef<number | null>(null);

	// (B1/B4/B7: Thumbnail fetching moved to usePageImage hook above — no useEffect needed)

	// Keyboard listeners for Spacebar panning + tool shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't intercept if typing in an input/textarea
			const tag = (e.target as HTMLElement).tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
				return;

			if (e.code === "Space") {
				e.preventDefault();
				setIsSpaceDown(true);
				return;
			}

			// Tool shortcuts (no modifier keys)
			if (!e.ctrlKey && !e.metaKey && !e.altKey) {
				switch (e.key.toLowerCase()) {
					case "v":
						setTool("select");
						break;
					case "h":
						setTool("pan");
						break;
					case "t":
						setTool("text");
						break;
					case "l":
						setTool("link");
						break;
					case "f":
						setTool("form-text");
						break;
					case "w":
						setTool("whiteout");
						break;
					case "delete":
					case "backspace":
						if (selectedNodeIds.length > 0 && activePageId) {
							const store = useEditorStore.getState();
							for (const id of selectedNodeIds) {
								store.deleteAnnotation(activePageId, id);
							}
							setSelectedNodes([]);
						}
						break;
				}
			}
		};
		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.code === "Space") {
				setIsSpaceDown(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
		};
	}, [setTool, selectedNodeIds, activePageId, setSelectedNodes]);

	const isPanMode = activeTool === "pan" || isSpaceDown;

	// Step 2: Use functional update + ref to avoid stale closures
	const handleWheel = useCallback(
		(e: React.WheelEvent<HTMLElement>) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
				setZoom(
					Math.min(Math.max(0.1, zoomRef.current + zoomDelta), 5.0),
				);
			} else if (!isPanMode) {
				// Functional update avoids stale panOffset in rapid scroll
				setPanOffset({
					x: panOffsetRef.current.x - e.deltaX,
					y: panOffsetRef.current.y - e.deltaY,
				});
			}
		},
		[setZoom, setPanOffset, isPanMode],
	);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			if (isPanMode || e.button === 1) {
				setIsPanning(true);
				e.currentTarget.setPointerCapture(e.pointerId);
			} else if (activeTool === "select") {
				setSelectedNodes([]);
			}
		},
		[isPanMode, activeTool, setSelectedNodes],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			if (isPanning) {
				// Use ref for latest pan offset
				setPanOffset({
					x: panOffsetRef.current.x + e.movementX,
					y: panOffsetRef.current.y + e.movementY,
				});
			}
		},
		[isPanning, setPanOffset],
	);

	const handlePointerUp = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			if (isPanning) {
				setIsPanning(false);
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
		},
		[isPanning],
	);

	// Page-level drawing interactions (link/form/whiteout region draw)
	const handlePagePointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (isPanMode) return;
			if (
				activeTool === "link" ||
				activeTool === "form-text" ||
				activeTool === "whiteout"
			) {
				e.stopPropagation();
				const rect = e.currentTarget.getBoundingClientRect();
				const zoom = zoomRef.current;
				const x = (e.clientX - rect.left) / zoom;
				const y = (e.clientY - rect.top) / zoom;
				setDragStart({ x, y });
				setDragCurrent({ x, y });
				e.currentTarget.setPointerCapture(e.pointerId);
			}
		},
		[isPanMode, activeTool],
	);

	const handlePagePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			// Region draw only — annotation drag is handled by AnnotationNode handlers
			if (
				dragStart &&
				(activeTool === "link" ||
					activeTool === "form-text" ||
					activeTool === "whiteout")
			) {
				const rect = e.currentTarget.getBoundingClientRect();
				const zoom = zoomRef.current;
				const x = (e.clientX - rect.left) / zoom;
				const y = (e.clientY - rect.top) / zoom;
				setDragCurrent({ x, y });
			}
			// Step 3: Removed duplicate annotation drag handler from here.
			// Annotation drag is handled exclusively by handleAnnotationDragMove.
		},
		[dragStart, activeTool],
	);

	const handlePagePointerUp = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			// Region draw completion
			if (dragStart && dragCurrent) {
				const x = Math.min(dragStart.x, dragCurrent.x);
				const y = Math.min(dragStart.y, dragCurrent.y);
				const width = Math.abs(dragCurrent.x - dragStart.x);
				const height = Math.abs(dragCurrent.y - dragStart.y);

				if (width > 5 && height > 5 && activePageId) {
					const defaultText =
						activeTool === "link"
							? "https://example.com"
							: activeTool === "whiteout"
								? ""
								: "Text Field";
					addAnnotation(
						activePageId,
						activeTool as AnnotationType,
						defaultText,
						x,
						y,
						width,
						height,
					);
				}

				setDragStart(null);
				setDragCurrent(null);
				e.currentTarget.releasePointerCapture(e.pointerId);
				setTool("select");
			}
		},
		[
			dragStart,
			dragCurrent,
			activePageId,
			activeTool,
			addAnnotation,
			setTool,
		],
	);

	const handlePageClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (isPanMode) return;

			if (activeTool === "text") {
				if (inputPos) {
					if (inputText.trim() && activePageId) {
						addAnnotation(
							activePageId,
							"text",
							inputText,
							inputPos.x,
							inputPos.y,
						);
					}
					setInputPos(null);
					setInputText("");
					setTool("select");
				} else {
					const rect = e.currentTarget.getBoundingClientRect();
					const zoom = zoomRef.current;
					setInputPos({
						x: (e.clientX - rect.left) / zoom,
						y: (e.clientY - rect.top) / zoom,
					});
				}
			}
		},
		[
			isPanMode,
			activeTool,
			inputPos,
			inputText,
			activePageId,
			addAnnotation,
			setTool,
		],
	);

	const handleInputKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter") {
				if (inputText.trim() && activePageId && inputPos) {
					addAnnotation(
						activePageId,
						"text",
						inputText,
						inputPos.x,
						inputPos.y,
					);
				}
				setInputPos(null);
				setInputText("");
				setTool("select");
			}
			if (e.key === "Escape") {
				setInputPos(null);
				setInputText("");
				setTool("select");
			}
		},
		[inputText, activePageId, inputPos, addAnnotation, setTool],
	);

	// Step 1: Stable callback identity for React.memo
	const handleNodeClick = useCallback(
		(e: React.MouseEvent, id: string) => {
			e.stopPropagation();
			if (activeTool === "select") {
				setSelectedNodes([id]);
			}
		},
		[activeTool, setSelectedNodes],
	);

	// Step 4: Capture pageRect on drag start for stable coordinate mapping
	const handleAnnotationDragStart = useCallback(
		(e: React.PointerEvent, ann: PageAnnotation) => {
			e.stopPropagation();
			setSelectedNodes([ann.id]);

			// Capture the page element's bounding rect at drag start
			const pageEl = e.currentTarget.parentElement;
			if (!pageEl) return;
			const pageRect = pageEl.getBoundingClientRect();
			const zoom = zoomRef.current;
			const curX = (e.clientX - pageRect.left) / zoom;
			const curY = (e.clientY - pageRect.top) / zoom;

			dragRef.current = {
				annId: ann.id,
				startX: curX,
				startY: curY,
				origX: ann.x,
				origY: ann.y,
				annWidth: ann.width || 0,
				annHeight: ann.height || 0,
				pageRect, // Step 4: stored for use during move
				zoomAtStart: zoom,
				historySaved: false,
				hasMoved: false,
			};

			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		},
		[setSelectedNodes],
	);

	const handleAnnotationDragMove = useCallback(
		(e: React.PointerEvent) => {
			if (!dragRef.current || !activePageId) return;

			const { pageRect, zoomAtStart } = dragRef.current;
			const curX = (e.clientX - pageRect.left) / zoomAtStart;
			const curY = (e.clientY - pageRect.top) / zoomAtStart;
			const dx = curX - dragRef.current.startX;
			const dy = curY - dragRef.current.startY;

			// Minimum drag threshold to avoid accidental moves on click
			if (
				!dragRef.current.hasMoved &&
				Math.abs(dx) < MIN_DRAG_THRESHOLD &&
				Math.abs(dy) < MIN_DRAG_THRESHOLD
			) {
				return;
			}
			dragRef.current.hasMoved = true;

			if (!dragRef.current.historySaved) {
				saveHistory();
				dragRef.current.historySaved = true;
			}

			// Step 5: Clamp to page bounds
			let newX = dragRef.current.origX + dx;
			let newY = dragRef.current.origY + dy;
			const maxX =
				PAGE_WIDTH -
				(dragRef.current.annWidth > 0 ? dragRef.current.annWidth : 20);
			const maxY =
				PAGE_HEIGHT -
				(dragRef.current.annHeight > 0
					? dragRef.current.annHeight
					: 20);
			newX = Math.max(0, Math.min(newX, maxX));
			newY = Math.max(0, Math.min(newY, maxY));

			// B2: RAF-throttled store update — avoids 60 store writes/sec
			const annId = dragRef.current.annId;
			const pageId = activePageId;
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(() => {
				moveAnnotation(pageId, annId, newX, newY);
				rafRef.current = null;
			});
		},
		[activePageId, saveHistory, moveAnnotation],
	);

	const handleAnnotationDragEnd = useCallback((e: React.PointerEvent) => {
		if (dragRef.current) {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
			dragRef.current = null;
		}
	}, []);

	const handleAnnotationResizeStart = useCallback(
		(e: React.PointerEvent, ann: PageAnnotation) => {
			e.stopPropagation();
			const pageEl = (e.currentTarget as HTMLElement).parentElement;
			if (!pageEl) return;
			const pageRect = pageEl.getBoundingClientRect();
			const zoom = zoomRef.current;
			resizeRef.current = {
				annId: ann.id,
				startX: (e.clientX - pageRect.left) / zoom,
				startY: (e.clientY - pageRect.top) / zoom,
				origW: ann.width ?? 140,
				origH: ann.height ?? 36,
				pageRect,
				zoomAtStart: zoom,
				annType: ann.type,
				historySaved: false,
			};
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		},
		[],
	);

	const handleAnnotationResizeMove = useCallback(
		(e: React.PointerEvent) => {
			if (!resizeRef.current || !activePageId) return;
			const { pageRect, zoomAtStart, origW, origH, annId, annType } =
				resizeRef.current;
			if (!resizeRef.current.historySaved) {
				saveHistory();
				resizeRef.current.historySaved = true;
			}
			const curX = (e.clientX - pageRect.left) / zoomAtStart;
			const curY = (e.clientY - pageRect.top) / zoomAtStart;
			const dx = curX - resizeRef.current.startX;
			const dy = curY - resizeRef.current.startY;

			// B2: RAF-throttled resize update
			const pageId = activePageId;
			const w = origW + dx;
			const h = origH + dy;
			const scaleText = annType === "text";
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(() => {
				resizeAnnotation(pageId, annId, {
					width: w,
					height: h,
					scaleText,
				});
				rafRef.current = null;
			});
		},
		[activePageId, resizeAnnotation, saveHistory],
	);

	const handleAnnotationResizeEnd = useCallback((e: React.PointerEvent) => {
		if (resizeRef.current) {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
			resizeRef.current = null;
		}
	}, []);

	const renderLiveDragBox = () => {
		if (!dragStart || !dragCurrent) return null;
		const x = Math.min(dragStart.x, dragCurrent.x);
		const y = Math.min(dragStart.y, dragCurrent.y);
		const width = Math.abs(dragCurrent.x - dragStart.x);
		const height = Math.abs(dragCurrent.y - dragStart.y);
		const isLink = activeTool === "link";
		const isWhiteout = activeTool === "whiteout";

		const borderColor = isLink
			? "#8be9fd"
			: isWhiteout
				? "#ff5555"
				: "#f1fa8c";
		const bgColor = isLink
			? "rgba(139, 233, 253, 0.2)"
			: isWhiteout
				? "rgba(255, 85, 85, 0.2)"
				: "rgba(241, 250, 140, 0.2)";

		return (
			<div
				style={{
					position: "absolute",
					left: x,
					top: y,
					width,
					height,
					border: `2px dashed ${borderColor}`,
					backgroundColor: bgColor,
					pointerEvents: "none",
				}}
			/>
		);
	};

	// Memoize transform style to avoid new object on every render
	const wrapperStyle = useMemo(
		() => ({
			transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
			transition: isPanning
				? "none"
				: "transform 0.1s cubic-bezier(0.2, 0, 0, 1)",
		}),
		[panOffset.x, panOffset.y, zoomLevel, isPanning],
	);

	const handleLinkIntercept = useCallback(
		async (e: React.MouseEvent<HTMLDivElement>) => {
			const target = e.target as HTMLElement;
			const anchor = target.closest("a");
			if (anchor && anchor.href) {
				e.preventDefault();
				e.stopPropagation();

				// Don't interrupt users trying to draw annotations over links
				if (activeTool !== "select" && activeTool !== "pan") return;

				try {
					const confirmed = await ask(
						`Do you want to trust and open this link in your browser?\n\n${anchor.href}`,
						{
							title: "External Link Verification",
							kind: "info",
						},
					);
					if (confirmed) {
						await open(anchor.href);
					}
				} catch (err) {
					console.error("Failed to route link:", err);
				}
			}
		},
		[activeTool],
	);

	return (
		<main
			className="editor-canvas"
			onWheel={handleWheel}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			style={{
				cursor: isPanMode
					? isPanning
						? "grabbing"
						: "grab"
					: activeTool === "text"
						? "text"
						: activeTool === "link" ||
							  activeTool === "form-text" ||
							  activeTool === "whiteout"
							? "crosshair"
							: "default",
				overflow: "hidden",
			}}
		>
			<div className="page-wrapper" style={wrapperStyle}>
				{activePage ? (
					<div
						className="pdf-page-placeholder"
						onClickCapture={handleLinkIntercept}
						style={{
							transform: `rotate(${activePage.rotation}deg)`,
						}}
						onClick={handlePageClick}
						onPointerDown={handlePagePointerDown}
						onPointerMove={handlePagePointerMove}
						onPointerUp={handlePagePointerUp}
					>
						{docId ? (
							<ReliablePdfDocument
								fileId={docId}
								refreshToken={pdfContentVersion}
							>
								<PdfPagePreview
									pageNumber={activePage.number}
									width={612}
									devicePixelRatio={
										window.devicePixelRatio *
										Math.max(1, zoomLevel)
									}
									renderTextLayer={true}
									renderAnnotationLayer={true}
									className="pdf-page-react"
								/>
							</ReliablePdfDocument>
						) : (
							<div className="pdf-page-placeholder-text">
								Select a file to begin
							</div>
						)}

						{/* Ensure old relative annotation coordinate space functions normally over the React PDF */}
						{activePage.annotations?.map((ann) => (
							<AnnotationNode
								key={ann.id}
								ann={ann}
								isSelected={selectedNodeIds.includes(ann.id)}
								activeTool={activeTool}
								onSelect={handleNodeClick}
								onDragStart={handleAnnotationDragStart}
								onDragMove={handleAnnotationDragMove}
								onDragEnd={handleAnnotationDragEnd}
								onResizeStart={handleAnnotationResizeStart}
								onResizeMove={handleAnnotationResizeMove}
								onResizeEnd={handleAnnotationResizeEnd}
							/>
						))}

						{renderLiveDragBox()}

						{inputPos && activeTool === "text" && (
							<input
								autoFocus
								type="text"
								value={inputText}
								onChange={(e) => setInputText(e.target.value)}
								onKeyDown={handleInputKeyDown}
								onClick={(e) => e.stopPropagation()}
								style={{
									position: "absolute",
									left: inputPos.x,
									top: inputPos.y,
									background: "rgba(0,0,0,0.8)",
									color: textColor,
									fontFamily: textFontFamily,
									fontSize: textFontSize,
									border: "1px solid var(--accent-primary)",
									padding: "4px 8px",
									outline: "none",
									borderRadius: "4px",
								}}
								placeholder="Type and press Enter..."
							/>
						)}
					</div>
				) : (
					<div className="empty-state">Select a page to edit</div>
				)}
			</div>
		</main>
	);
};
