import React from "react";
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
import { Trash2 } from "lucide-react";
import { ReliablePdfDocument, PdfPagePreview } from "../../pdf/SharedPdfRendering";

export interface OrganizePageItem {
	id: string;
	path: string;
	pageNumber: number;
}

interface SortableOrganizeItemProps {
	item: OrganizePageItem;
	onRemove: (id: string) => void;
}

const SortableOrganizeItem = React.memo(
	({ item, onRemove }: SortableOrganizeItemProps) => {
		const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
			useSortable({ id: item.id });

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
							width={180}
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
					<Trash2 size={14} /> Remove
				</button>
				<div className="merge-item-label">Page {item.pageNumber}</div>
			</div>
		);
	},
);

interface OrganizePanelProps {
	items: OrganizePageItem[];
	onItemsChange: (items: OrganizePageItem[]) => void;
	onRemoveItem: (id: string) => void;
}

export const OrganizePanel: React.FC<OrganizePanelProps> = ({
	items,
	onItemsChange,
	onRemoveItem,
}) => {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (over && active.id !== over.id) {
			const oldIndex = items.findIndex((i) => i.id === active.id);
			const newIndex = items.findIndex((i) => i.id === over.id);
			const next = [...items];
			const [moved] = next.splice(oldIndex, 1);
			next.splice(newIndex, 0, moved);
			onItemsChange(next);
		}
	};

	return (
		<div className="delete-pages-panel">
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={items.map((i) => i.id)}
					strategy={rectSortingStrategy}
				>
					<div className="delete-pages-grid">
						{items.map((item) => (
							<SortableOrganizeItem
								key={item.id}
								item={item}
								onRemove={onRemoveItem}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
		</div>
	);
};
