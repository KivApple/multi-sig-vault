import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';

export interface SortableRowProps {
  id: string;
  /** Drag handle is shown and active only while editing. */
  editing: boolean;
  children: ReactNode;
}

/** A list row that can be dragged by its handle inside `SortableList`. */
export const SortableRow: React.FC<SortableRowProps> = ({ id, editing, children }) => {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-stretch gap-1 ${isDragging ? 'relative z-10 opacity-90' : ''}`}
    >
      {editing && (
        <button
          type="button"
          className="text-base-content/40 hover:text-base-content flex w-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          aria-label={t('common.dragToReorder')}
          title={t('common.dragToReorder')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
};
