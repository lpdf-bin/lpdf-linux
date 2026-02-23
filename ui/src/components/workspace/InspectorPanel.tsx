import React from "react";
import { useEditorStore } from "../../state/editorStore";
import { RotateCw, Trash2 } from "lucide-react";

export const InspectorPanel: React.FC = () => {
	const {
		activePageId,
		pages,
		rotateActivePage,
		selectedNodeIds,
		deleteAnnotation,
		setSelectedNodes,
	} = useEditorStore();

	const activePage = pages.find((p) => p.id === activePageId);
	if (!activePage) return null;

	// Step 9: Find the selected annotation (if any)
	const selectedAnn =
		selectedNodeIds.length === 1
			? activePage.annotations.find((a) => a.id === selectedNodeIds[0])
			: null;

	const handleDeleteSelected = () => {
		if (selectedAnn && activePageId) {
			deleteAnnotation(activePageId, selectedAnn.id);
			setSelectedNodes([]);
		}
	};

	return (
		<aside className="inspector-panel">
			<div className="inspector-header">Properties</div>
			<div className="inspector-content">
				{/* Page properties */}
				<div className="prop-row">
					<span className="prop-label">Page</span>
					<span className="prop-val">{activePage.number}</span>
				</div>
				<div className="prop-row">
					<span className="prop-label">Size</span>
					<span className="prop-val">8.5 × 11 in</span>
				</div>
				<div className="prop-row">
					<span className="prop-label">Rotation</span>
					<span className="prop-val">{activePage.rotation}°</span>
				</div>

				<div className="prop-actions">
					<button
						className="btn-primary"
						style={{
							width: "100%",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: "8px",
							marginTop: "16px",
						}}
						onClick={() => rotateActivePage(90)}
					>
						<RotateCw size={16} /> Rotate 90°
					</button>
				</div>

				{/* Selected annotation properties */}
				{selectedAnn && (
					<>
						<hr className="divider" />
						<div
							style={{
								fontSize: 11,
								fontWeight: 600,
								textTransform: "uppercase",
								color: "var(--text-muted)",
								letterSpacing: "0.5px",
								marginBottom: 4,
							}}
						>
							Selected Object
						</div>
						<div className="prop-row">
							<span className="prop-label">Type</span>
							<span className="prop-val">{selectedAnn.type}</span>
						</div>
						<div className="prop-row">
							<span className="prop-label">X</span>
							<span className="prop-val">
								{Math.round(selectedAnn.x)}
							</span>
						</div>
						<div className="prop-row">
							<span className="prop-label">Y</span>
							<span className="prop-val">
								{Math.round(selectedAnn.y)}
							</span>
						</div>
						{selectedAnn.width != null && (
							<div className="prop-row">
								<span className="prop-label">Width</span>
								<span className="prop-val">
									{Math.round(selectedAnn.width)}
								</span>
							</div>
						)}
						{selectedAnn.height != null && (
							<div className="prop-row">
								<span className="prop-label">Height</span>
								<span className="prop-val">
									{Math.round(selectedAnn.height)}
								</span>
							</div>
						)}
						{selectedAnn.color && (
							<div className="prop-row">
								<span className="prop-label">Color</span>
								<span
									className="prop-val"
									style={{
										display: "flex",
										alignItems: "center",
										gap: 4,
									}}
								>
									<span
										style={{
											width: 12,
											height: 12,
											borderRadius: "50%",
											backgroundColor: selectedAnn.color,
											display: "inline-block",
											border: "1px solid var(--border-subtle)",
										}}
									/>
									{selectedAnn.color}
								</span>
							</div>
						)}
						{selectedAnn.fontFamily && (
							<div className="prop-row">
								<span className="prop-label">Font</span>
								<span className="prop-val">
									{selectedAnn.fontFamily}
								</span>
							</div>
						)}
						{selectedAnn.fontSize != null && (
							<div className="prop-row">
								<span className="prop-label">Size</span>
								<span className="prop-val">
									{selectedAnn.fontSize}px
								</span>
							</div>
						)}
						<button
							className="btn-primary"
							style={{
								width: "100%",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: "8px",
								marginTop: "8px",
								backgroundColor: "var(--status-danger)",
							}}
							onClick={handleDeleteSelected}
						>
							<Trash2 size={16} /> Delete
						</button>
					</>
				)}

				<hr className="divider" />
				<div className="prop-row crypto-row">
					<span className="prop-label text-accent">SHA-256</span>
					<span
						className="prop-val mono truncate"
						title="e3b0c442...985"
					>
						e3b0c442...
					</span>
				</div>
			</div>
		</aside>
	);
};
