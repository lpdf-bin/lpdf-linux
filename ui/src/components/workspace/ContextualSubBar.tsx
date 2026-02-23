import React, { useRef } from "react";
import { useEditorStore } from "../../state/editorStore";
import type { PageAnnotation } from "../../state/editorStore";
import {
	Palette,
	AlignLeft,
	AlignCenter,
	AlignRight,
	Link as LinkIcon,
	ExternalLink,
	SquareMenu,
} from "lucide-react";

const PRESET_COLORS = [
	"#000000",
	"#f8f8f2",
	"#ff79c6",
	"#8be9fd",
	"#50fa7b",
	"#ff5555",
	"#bd93f9",
	"#f1fa8c",
];

export const ContextualSubBar: React.FC = () => {
	const {
		activeTool,
		isDocLoaded,
		activePageId,
		pages,
		selectedNodeIds,
		textColor,
		textFontFamily,
		textFontSize,
		setTextColor,
		setTextFontFamily,
		setTextFontSize,
		whiteoutBorderEnabledDefault,
		whiteoutBorderColorDefault,
		setWhiteoutBorderEnabledDefault,
		setWhiteoutBorderColorDefault,
		updateAnnotation,
	} = useEditorStore();

	const colorInputRef = useRef<HTMLInputElement>(null);

	if (!isDocLoaded) return null;

	// Step 6: Determine if a text annotation is selected
	const activePage = pages.find((p) => p.id === activePageId);
	let selectedTextAnn: PageAnnotation | null = null;
	let selectedWhiteoutAnn: PageAnnotation | null = null;
	if (selectedNodeIds.length === 1 && activePage) {
		const ann = activePage.annotations.find(
			(a) => a.id === selectedNodeIds[0],
		);
		if (ann && ann.type === "text") {
			selectedTextAnn = ann;
		}
		if (ann && ann.type === "whiteout") {
			selectedWhiteoutAnn = ann;
		}
	}

	// Show subbar for text tool OR when a text annotation is selected
	const showTextControls =
		activeTool === "text" ||
		(activeTool === "select" && selectedTextAnn !== null);
	const showWhiteoutControls =
		activeTool === "whiteout" ||
		(activeTool === "select" && selectedWhiteoutAnn !== null);

	if (
		!showTextControls &&
		!showWhiteoutControls &&
		activeTool !== "link" &&
		activeTool !== "form-text"
	) {
		return null;
	}

	// Effective values: from selected annotation or from defaults
	const effectiveColor = selectedTextAnn?.color || textColor;
	const effectiveFont = selectedTextAnn?.fontFamily || textFontFamily;
	const effectiveSize = selectedTextAnn?.fontSize || textFontSize;
	const effectiveWhiteoutBorderEnabled =
		selectedWhiteoutAnn?.borderEnabled ?? whiteoutBorderEnabledDefault;
	const effectiveWhiteoutBorderColor =
		selectedWhiteoutAnn?.borderColor || whiteoutBorderColorDefault;

	const handleColorChange = (color: string) => {
		setTextColor(color); // Always update default
		if (selectedTextAnn && activePageId) {
			updateAnnotation(activePageId, selectedTextAnn.id, { color });
		}
	};

	const handleFontChange = (fontFamily: string) => {
		setTextFontFamily(fontFamily);
		if (selectedTextAnn && activePageId) {
			updateAnnotation(activePageId, selectedTextAnn.id, { fontFamily });
		}
	};

	const handleSizeChange = (fontSize: number) => {
		setTextFontSize(fontSize);
		if (selectedTextAnn && activePageId) {
			updateAnnotation(activePageId, selectedTextAnn.id, { fontSize });
		}
	};

	const handleWhiteoutBorderEnabledChange = (enabled: boolean) => {
		setWhiteoutBorderEnabledDefault(enabled);
		if (selectedWhiteoutAnn && activePageId) {
			updateAnnotation(activePageId, selectedWhiteoutAnn.id, {
				borderEnabled: enabled,
			});
		}
	};

	const handleWhiteoutBorderColorChange = (color: string) => {
		setWhiteoutBorderColorDefault(color);
		if (selectedWhiteoutAnn && activePageId) {
			updateAnnotation(activePageId, selectedWhiteoutAnn.id, {
				borderColor: color,
			});
		}
	};

	return (
		<div className="contextual-subbar">
			{showTextControls && (
				<>
					<div className="subbar-group">
						<span className="subbar-label">Font</span>
						<select
							className="subbar-select themed-select"
							value={effectiveFont}
							onChange={(e) => handleFontChange(e.target.value)}
						>
							<option value="Inter">Inter</option>
							<option value="Roboto">Roboto</option>
							<option value="Helvetica">Helvetica</option>
							<option value="Times New Roman">
								Times New Roman
							</option>
							<option value="Georgia">Georgia</option>
							<option value="Courier New">Courier New</option>
						</select>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group">
						<span className="subbar-label">Size</span>
						<input
							type="number"
							className="subbar-input sm"
							value={effectiveSize}
							min={8}
							max={72}
							onChange={(e) => {
								const v = parseInt(e.target.value, 10);
								if (!isNaN(v) && v >= 8 && v <= 72)
									handleSizeChange(v);
							}}
						/>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group">
						<button className="icon-btn sm active">
							<AlignLeft size={14} />
						</button>
						<button className="icon-btn sm">
							<AlignCenter size={14} />
						</button>
						<button className="icon-btn sm">
							<AlignRight size={14} />
						</button>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group">
						<span className="subbar-label">Color</span>
						{PRESET_COLORS.map((c) => (
							<button
								key={c}
								className="color-btn"
								style={{
									backgroundColor: c,
									boxShadow:
										effectiveColor === c
											? `0 0 0 2px var(--accent-primary)`
											: "none",
								}}
								onClick={() => handleColorChange(c)}
								title={c}
							/>
						))}
						<input
							ref={colorInputRef}
							type="color"
							value={effectiveColor}
							onChange={(e) => handleColorChange(e.target.value)}
							style={{
								position: "absolute",
								opacity: 0,
								width: 0,
								height: 0,
								pointerEvents: "none",
							}}
						/>
						<button
							className="icon-btn sm"
							onClick={() => colorInputRef.current?.click()}
							title="Custom color"
						>
							<Palette size={14} />
						</button>
					</div>
				</>
			)}

			{activeTool === "link" && (
				<>
					<div className="subbar-group">
						<LinkIcon size={14} />
						<span className="subbar-label">Link Type</span>
						<select className="subbar-select themed-select">
							<option>External URL</option>
							<option>Internal Page</option>
							<option>Email Address</option>
							<option>Phone Number</option>
						</select>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group" style={{ flex: 1 }}>
						<ExternalLink size={14} />
						<input
							type="text"
							className="subbar-input"
							placeholder="https://example.com"
							style={{ width: "100%" }}
						/>
					</div>
				</>
			)}

			{activeTool === "form-text" && (
				<>
					<div className="subbar-group">
						<SquareMenu size={14} />
						<span className="subbar-label">Field Type</span>
						<select className="subbar-select themed-select">
							<option>Text Input</option>
							<option>Multi-line Area</option>
							<option>Checkbox</option>
							<option>Radio Button</option>
							<option>Signature</option>
						</select>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group">
						<span className="subbar-label">Field Name</span>
						<input
							type="text"
							className="subbar-input"
							placeholder="e.g. FirstName"
						/>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group">
						<label className="subbar-checkbox-label">
							<input type="checkbox" /> Required
						</label>
						<label className="subbar-checkbox-label">
							<input type="checkbox" /> Read Only
						</label>
					</div>
				</>
			)}

			{showWhiteoutControls && (
				<>
					<div className="subbar-group">
						<span className="subbar-label">Whiteout Border</span>
						<label className="subbar-checkbox-label">
							<input
								type="checkbox"
								checked={effectiveWhiteoutBorderEnabled}
								onChange={(e) =>
									handleWhiteoutBorderEnabledChange(
										e.target.checked,
									)
								}
							/>
							Show Border
						</label>
					</div>
					<div className="divider-vertical" />
					<div className="subbar-group">
						<span className="subbar-label">Border Color</span>
						<input
							type="color"
							value={effectiveWhiteoutBorderColor}
							onChange={(e) =>
								handleWhiteoutBorderColorChange(
									e.target.value,
								)
							}
							disabled={!effectiveWhiteoutBorderEnabled}
						/>
					</div>
				</>
			)}
		</div>
	);
};
