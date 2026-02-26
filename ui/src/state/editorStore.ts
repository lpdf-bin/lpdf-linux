import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";

export type AnnotationType = "text" | "link" | "form-text" | "whiteout";

export type AppToastKind = "success" | "warning" | "error" | "info";

export interface AppToast {
	id: string;
	kind: AppToastKind;
	title: string;
	message: string;
}

export interface PageAnnotation {
	id: string;
	type: AnnotationType;
	text: string; // text content, link URL, or form value
	x: number;
	y: number;
	width?: number;
	height?: number;
	color?: string;
	fontFamily?: string;
	fontSize?: number;
	borderEnabled?: boolean;
	borderColor?: string;
}

export interface PageModel {
	id: string; // Unique ID for DnD mapping
	number: number; // Original page number
	rotation: number; // 0, 90, 180, 270
	annotations: PageAnnotation[];
}

export type ToolMode =
	| "select"
	| "pan"
	| "text"
	| "link"
	| "form-text"
	| "whiteout"
	| "draw";

interface EditorState {
	isDocLoaded: boolean;
	docId: string | null;
	activePageId: string | null;
	pages: PageModel[];
	zoomLevel: number;
	theme: "dark" | "light";
	isSettingsOpen: boolean;
	showWhiteoutWarning: boolean;
	toasts: AppToast[];
	pdfContentVersion: number;

	activeTool: ToolMode;
	panOffset: { x: number; y: number };
	selectedNodeIds: string[];

	// Text tool defaults
	textColor: string;
	textFontFamily: string;
	textFontSize: number;
	whiteoutBorderEnabledDefault: boolean;
	whiteoutBorderColorDefault: string;

	past: PageModel[][];
	future: PageModel[][];

	// Actions
	loadDoc: (docId: string, pageCount?: number) => void;
	setActivePageId: (id: string) => void;
	setZoom: (level: number) => void;
	setTool: (tool: ToolMode) => void;
	setPanOffset: (pan: { x: number; y: number }) => void;
	setSelectedNodes: (ids: string[]) => void;
	rotateActivePage: (degrees: number) => void;
	reorderPages: (activeId: string, overId: string) => void;
	toggleTheme: () => void;
	openSettings: () => void;
	closeSettings: () => void;
	dismissWhiteoutWarning: () => void;
	pushToast: (toast: {
		kind: AppToastKind;
		title: string;
		message: string;
		timeoutMs?: number;
	}) => void;
	dismissToast: (id: string) => void;
	bumpPdfContentVersion: () => void;
	undo: () => void;
	redo: () => void;
	saveHistory: () => void;
	addAnnotation: (
		pageId: string,
		type: AnnotationType,
		text: string,
		x: number,
		y: number,
		width?: number,
		height?: number,
	) => void;
	updateAnnotation: (
		pageId: string,
		annId: string,
		patch: Partial<PageAnnotation>,
	) => void;
	moveAnnotation: (
		pageId: string,
		annId: string,
		x: number,
		y: number,
	) => void;
	deleteAnnotation: (pageId: string, annId: string) => void;
	deleteActivePage: () => boolean;
	setTextColor: (color: string) => void;
	setTextFontFamily: (family: string) => void;
	setTextFontSize: (size: number) => void;
	setWhiteoutBorderEnabledDefault: (enabled: boolean) => void;
	setWhiteoutBorderColorDefault: (color: string) => void;
	resizeAnnotation: (
		pageId: string,
		annId: string,
		patch: { width: number; height: number; scaleText?: boolean },
	) => void;
	closeDoc: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
	isDocLoaded: false,
	docId: null,
	activePageId: null,
	pages: [],
	zoomLevel: 1.0,
	theme: "dark",
	isSettingsOpen: false,
	showWhiteoutWarning: false,
	toasts: [],
	pdfContentVersion: 0,

	activeTool: "select",
	panOffset: { x: 0, y: 0 },
	selectedNodeIds: [],

	textColor: "#000000",
	textFontFamily: "Inter",
	textFontSize: 14,
	whiteoutBorderEnabledDefault: false,
	whiteoutBorderColorDefault: "#ff5555",

	past: [],
	future: [],

	loadDoc: (docId: string, pageCount: number = 1) => {
		const actualPages: PageModel[] = Array.from(
			{ length: pageCount },
			(_, i) => ({
				id: `page-${i + 1}`,
				number: i + 1,
				rotation: 0,
				annotations: [],
			}),
		);

		set({
			isDocLoaded: true,
			docId,
			activePageId: actualPages[0]?.id || null,
			pages: actualPages,
			zoomLevel: 1.0,
			past: [],
			future: [],
		});
	},

	setActivePageId: (id) => set({ activePageId: id }),

	setZoom: (level) => set({ zoomLevel: level }),

	setTool: (tool) => {
		const isWhiteout = tool === "whiteout";
		set({
			activeTool: tool,
			selectedNodeIds: [],
			showWhiteoutWarning: isWhiteout ? true : false,
		});
	},

	dismissWhiteoutWarning: () => set({ showWhiteoutWarning: false }),

	dismissToast: (id) =>
		set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

	bumpPdfContentVersion: () =>
		set((state) => ({ pdfContentVersion: state.pdfContentVersion + 1 })),

	pushToast: ({ kind, title, message, timeoutMs = 3000 }) => {
		const id = crypto.randomUUID();
		set((state) => ({
			toasts: [...state.toasts, { id, kind, title, message }],
		}));
		setTimeout(() => {
			set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
		}, timeoutMs);
	},

	setPanOffset: (pan) => set({ panOffset: pan }),

	setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),

	setTextColor: (color) => set({ textColor: color }),
	setTextFontFamily: (family) => set({ textFontFamily: family }),
	setTextFontSize: (size) => set({ textFontSize: size }),
	setWhiteoutBorderEnabledDefault: (enabled) =>
		set({ whiteoutBorderEnabledDefault: enabled }),
	setWhiteoutBorderColorDefault: (color) =>
		set({ whiteoutBorderColorDefault: color }),

	saveHistory: () => {
		const currentState = get();
		set({
			past: [...currentState.past, currentState.pages],
			future: [],
		});
	},

	undo: () => {
		const { past, future, pages } = get();
		if (past.length === 0) return;
		const newPast = [...past];
		const previousPages = newPast.pop() as PageModel[];
		set({
			pages: previousPages,
			past: newPast,
			future: [pages, ...future],
		});
	},

	redo: () => {
		const { past, future, pages } = get();
		if (future.length === 0) return;
		const newFuture = [...future];
		const nextPages = newFuture.shift() as PageModel[];
		set({
			pages: nextPages,
			past: [...past, pages],
			future: newFuture,
		});
	},

	rotateActivePage: (degrees) => {
		const { activePageId, pages, saveHistory } = get();
		if (!activePageId) return;

		saveHistory();

		set({
			pages: pages.map((p) => {
				if (p.id === activePageId) {
					let newRot = p.rotation + degrees;
					if (newRot >= 360) newRot -= 360;
					if (newRot < 0) newRot += 360;
					return { ...p, rotation: newRot };
				}
				return p;
			}),
		});
	},

	reorderPages: (activeId, overId) => {
		const { pages, saveHistory } = get();
		const oldIndex = pages.findIndex((p) => p.id === activeId);
		const newIndex = pages.findIndex((p) => p.id === overId);

		if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
			saveHistory();
			set({
				pages: arrayMove(pages, oldIndex, newIndex),
			});
		}
	},

	addAnnotation: (pageId, type, text, x, y, width, height) => {
		const {
			pages,
			saveHistory,
			textColor,
			textFontFamily,
			textFontSize,
			whiteoutBorderEnabledDefault,
			whiteoutBorderColorDefault,
		} = get();
		saveHistory();

		const resolvedWidth =
			type === "text" && width === undefined ? 140 : width;
		const resolvedHeight =
			type === "text" && height === undefined ? 36 : height;

		set({
			pages: pages.map((p) => {
				if (p.id === pageId) {
					return {
						...p,
						annotations: [
							...p.annotations,
							{
								id: crypto.randomUUID(),
								type,
								text,
								x,
								y,
								width: resolvedWidth,
								height: resolvedHeight,
								color: type === "text" ? textColor : undefined,
								fontFamily:
									type === "text"
										? textFontFamily
										: undefined,
								fontSize:
									type === "text" ? textFontSize : undefined,
								borderEnabled:
									type === "whiteout"
										? whiteoutBorderEnabledDefault
										: undefined,
								borderColor:
									type === "whiteout"
										? whiteoutBorderColorDefault
										: undefined,
							},
						],
					};
				}
				return p;
			}),
		});
	},

	updateAnnotation: (pageId, annId, patch) => {
		const { pages, saveHistory } = get();
		saveHistory();
		set({
			pages: pages.map((p) => {
				if (p.id !== pageId) return p;
				return {
					...p,
					annotations: p.annotations.map((a) =>
						a.id === annId ? { ...a, ...patch } : a,
					),
				};
			}),
		});
	},

	moveAnnotation: (pageId, annId, x, y) => {
		const { pages } = get();
		// Move without saving history on every pixel — caller saves once on drag start
		set({
			pages: pages.map((p) => {
				if (p.id !== pageId) return p;
				return {
					...p,
					annotations: p.annotations.map((a) =>
						a.id === annId ? { ...a, x, y } : a,
					),
				};
			}),
		});
	},

	resizeAnnotation: (pageId, annId, patch) => {
		const { pages } = get();
		// Resize updates can happen every pointer move; caller saves history once.
		const minWidth = 20;
		const minHeight = 20;
		set({
			pages: pages.map((p) => {
				if (p.id !== pageId) return p;
				return {
					...p,
					annotations: p.annotations.map((a) => {
						if (a.id !== annId) return a;
						const nextWidth = Math.max(minWidth, patch.width);
						const nextHeight = Math.max(minHeight, patch.height);
						if (a.type === "text" && patch.scaleText) {
							const baseWidth = a.width ?? 140;
							const baseHeight = a.height ?? 36;
							const baseFont = a.fontSize ?? 14;
							const scale = Math.min(
								nextWidth / baseWidth,
								nextHeight / baseHeight,
							);
							return {
								...a,
								width: nextWidth,
								height: nextHeight,
								fontSize: Math.max(8, Math.round(baseFont * scale)),
							};
						}
						return {
							...a,
							width: nextWidth,
							height: nextHeight,
						};
					}),
				};
			}),
		});
	},

	deleteAnnotation: (pageId, annId) => {
		const { pages, saveHistory } = get();
		saveHistory();
		set({
			pages: pages.map((p) => {
				if (p.id !== pageId) return p;
				return {
					...p,
					annotations: p.annotations.filter((a) => a.id !== annId),
				};
			}),
		});
	},

	deleteActivePage: () => {
		const { pages, activePageId, saveHistory } = get();
		if (!activePageId || pages.length <= 1) return false;

		const activeIndex = pages.findIndex((p) => p.id === activePageId);
		if (activeIndex === -1) return false;

		saveHistory();

		const nextPages = pages
			.filter((p) => p.id !== activePageId)
			.map((p, i) => ({ ...p, number: i + 1 }));
		const nextActive =
			nextPages[Math.min(activeIndex, nextPages.length - 1)]?.id ?? null;

		set({
			pages: nextPages,
			activePageId: nextActive,
		});

		return true;
	},

	toggleTheme: () =>
		set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),

	openSettings: () => set({ isSettingsOpen: true }),
	closeSettings: () => set({ isSettingsOpen: false }),

	closeDoc: () =>
		set({
			isDocLoaded: false,
			docId: null,
			activePageId: null,
			pages: [],
			zoomLevel: 1.0,
			activeTool: "select",
			panOffset: { x: 0, y: 0 },
			selectedNodeIds: [],
			toasts: [],
			pdfContentVersion: 0,
			past: [],
			future: [],
		}),
}));
