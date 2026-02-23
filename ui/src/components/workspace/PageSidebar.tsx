import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEditorStore } from "../../state/editorStore";
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
	verticalListSortingStrategy,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReliablePdfDocument, PdfPagePreview } from "../pdf/SharedPdfRendering";

interface SortableThumbnailProps {
	id: string;
	pageNumber: number;
	rotation: number;
	isActive: boolean;
	virtualTop: number;
	onClick: () => void;
}

const SortableThumbnail = ({
	id,
	pageNumber,
	rotation,
	isActive,
	virtualTop,
	onClick,
}: SortableThumbnailProps) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	// No manual fetching needed, react-pdf handles it natively inside the parent <Document>

	const style = {
		// We use dnd-kit's transform, but we must use margin-top for absolute positioning
		// inside the react-virtual container so they don't fight over the `transform` CSS property.
		transform: CSS.Transform.toString(transform),
		transition,
		position: "absolute" as const,
		top: 0,
		left: 0,
		width: "100%",
		height: "180px",
		marginTop: `${virtualTop + 10}px`,
		zIndex: isDragging ? 10 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`thumbnail-item ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""}`}
			onClick={onClick}
		>
			<div
				className="thumbnail-card"
				{...attributes}
				{...listeners}
				style={{
					transform: `rotate(${rotation}deg)`,
					transition: "transform 0.2s",
				}}
			>
				<PdfPagePreview
					pageNumber={pageNumber}
					width={140}
					className="pdf-sidebar-react-page"
				/>
			</div>
			<span className="thumbnail-label">{pageNumber}</span>
		</div>
	);
};

export const PageSidebar: React.FC = () => {
	const { activePageId, setActivePageId, pages, reorderPages, docId } =
		useEditorStore();
	const parentRef = useRef<HTMLDivElement>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	// eslint-disable-next-line react-hooks/incompatible-library
	const rowVirtualizer = useVirtualizer({
		count: pages.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 200, // 180 + 20 gap/margin
		overscan: 5,
	});

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (over && active.id !== over.id) {
			reorderPages(active.id as string, over.id as string);
		}
	};

	return (
		<aside className="page-sidebar">
			<div className="sidebar-header">Thumbnails ({pages.length})</div>
			<div ref={parentRef} className="thumbnails-container">
				{docId ? (
					<ReliablePdfDocument
						fileId={docId}
						loading={
							<div className="sidebar-message">
								Loading pages...
							</div>
						}
						error={
							<div className="sidebar-message">
								Error loading PDF layout.
							</div>
						}
					>
						<DndContext
							sensors={sensors}
							collisionDetection={closestCenter}
							onDragEnd={handleDragEnd}
						>
							<SortableContext
								items={pages.map((p) => p.id)}
								strategy={verticalListSortingStrategy}
							>
								<div
									style={{
										height: `${rowVirtualizer.getTotalSize()}px`,
										width: "100%",
										position: "relative",
									}}
								>
									{rowVirtualizer
										.getVirtualItems()
										.map((virtualItem) => {
											const page =
												pages[virtualItem.index];
											if (!page) return null;

											return (
												<SortableThumbnail
													key={page.id}
													id={page.id}
													pageNumber={page.number}
													rotation={page.rotation}
													isActive={
														activePageId === page.id
													}
													virtualTop={
														virtualItem.start
													}
													onClick={() =>
														setActivePageId(page.id)
													}
												/>
											);
										})}
								</div>
							</SortableContext>
						</DndContext>
					</ReliablePdfDocument>
				) : (
					<div className="sidebar-message empty">
						No document open.
					</div>
				)}
			</div>
		</aside>
	);
};
