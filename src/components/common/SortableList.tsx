import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useCallback, type ReactNode } from 'react';

export interface SortableListProps {
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: ReactNode;
}

/** Vertical drag-and-drop list (mouse, touch with a short hold, keyboard). Rows use `SortableRow`. */
export const SortableList: React.FC<SortableListProps> = ({ ids, onReorder, children }) => {
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
};
