import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type Modifier,
} from "@dnd-kit/core";
import {
	arrayMove,
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useCallback, type ReactNode } from "react";

export interface SortableListProps {
	ids: string[];
	onReorder: (ids: string[]) => void;
	/**
	 * `grid` (default) – one column or several, items of one height. `column` – one column, items of any
	 * height. `rows` – one column that items cannot leave sideways: a list inside a card.
	 */
	layout?: "grid" | "column" | "rows";
	children: ReactNode;
}

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const VERTICAL_ONLY = [verticalOnly];

/**
 * Drag-and-drop list (mouse, touch with a short hold, keyboard). Rows use `SortableRow`.
 * The list may be one column or a grid: items are sorted by their rectangles, not by height alone.
 * A list may sit inside a row of another list: each one drags only its own rows.
 */
export const SortableList: React.FC<SortableListProps> = ({ ids, onReorder, layout = "grid", children }) => {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const handleDragEnd = useCallback(
		(e: DragEndEvent) => {
			if (!e.over || e.active.id === e.over.id) return;
			const from = ids.indexOf(String(e.active.id));
			const to = ids.indexOf(String(e.over.id));
			if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
		},
		[ids, onReorder],
	);
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={layout === "rows" ? VERTICAL_ONLY : undefined}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={ids} strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>
				{children}
			</SortableContext>
		</DndContext>
	);
};
